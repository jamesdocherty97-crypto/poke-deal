import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { getEbayConfig, isEbayConfigured } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { fetchEbayPolicies } from "@/lib/ebay/policies";
import { upsertInventoryItem } from "@/lib/ebay/inventoryItem";
import { createEbayOffer, getOfferBySku, updateEbayOffer } from "@/lib/ebay/offer";
import { buildEbayOfferPreflight } from "@/lib/ebay/preflight";
import { ebayApiErrorLogBody, ebayApiErrorResponseBody, isEbayApiError } from "@/lib/ebay/errors";
import { photoRequirementMessage, summarizeListingPhotos } from "@/lib/photos/listingPhotoPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  if (!isEbayConfigured()) {
    return NextResponse.json(
      { error: "eBay is not configured. Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME." },
      { status: 503 },
    );
  }

  const prisma = getPrisma();
  const listing = await prisma.listing.findUnique({
    where: { id: params.id },
    include: { item: { include: { card: true, photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] } } } },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }
  if (listing.channel !== "EBAY") {
    return NextResponse.json({ error: "Listing channel is not EBAY." }, { status: 400 });
  }
  if (listing.item.status === "SOLD") {
    return NextResponse.json({ error: "Item is already sold." }, { status: 400 });
  }
  if (listing.state === "ACTIVE" && listing.externalRef && !listing.externalRef.startsWith("offer:")) {
    return NextResponse.json(
      { error: "Listing is already published on eBay.", listingId: listing.externalRef },
      { status: 409 },
    );
  }

  const effectivePricePence = listing.listPrice ?? listing.suggestedPrice ?? 0;
  if (effectivePricePence <= 0) {
    return NextResponse.json(
      { error: "Set a price on the listing before creating an eBay offer." },
      { status: 400 },
    );
  }

  const config = getEbayConfig()!;

  try {
    const accessToken = await getAccessToken(config);
    const policies = await fetchEbayPolicies(config, accessToken);

    const packInput = {
      card: {
        name: listing.item.card.name,
        setName: listing.item.card.setName,
        number: listing.item.card.number,
        rarity: listing.item.card.rarity,
        language: listing.item.card.language,
      },
      grade: listing.item.grade,
      listPricePence: listing.listPrice ?? listing.suggestedPrice ?? undefined,
      condition: listing.item.condition ?? undefined,
      certNumber: listing.item.graderCert ?? undefined,
      usesCatalogOnlyImages: false,
    };
    const photoSummary = summarizeListingPhotos({
      photos: listing.item.photos,
      grade: listing.item.grade,
      pricePence: effectivePricePence,
    });
    if (!photoSummary.satisfiesEbayPhotoRequirement) {
      return NextResponse.json(
        { error: photoRequirementMessage(photoSummary), canUseCatalogArt: photoSummary.catalogPhotoAllowed },
        { status: 400 },
      );
    }
    packInput.usesCatalogOnlyImages = photoSummary.catalogOnly;

    const preflight = buildEbayOfferPreflight({
      listingId: params.id,
      itemId: listing.itemId,
      packInput,
      quantity: listing.item.quantity ?? 1,
      imageUrls: photoSummary.imageUrls,
      policies,
      config,
    });

    // Upsert the inventory item (idempotent — safe to call multiple times)
    await upsertInventoryItem(config, preflight.sku, preflight.inventoryItem, accessToken);

    // Use existing offer if one already exists for this SKU, but always sync it
    // with the latest preflight payload (price, policies, merchant location).
    // Without this, an offer created before e.g. the merchant location was set
    // up would stay stale forever and fail to publish with a vague eBay error.
    let offerId = await getOfferBySku(config, preflight.sku, accessToken);
    if (!offerId) {
      const created = await createEbayOffer(config, preflight.offer, accessToken);
      offerId = created.offerId;
    } else {
      await updateEbayOffer(config, offerId, preflight.offer, accessToken);
    }

    // Persist offer ID with prefix so we can distinguish it from a published listing ID
    await prisma.listing.update({
      where: { id: params.id },
      data: { externalRef: `offer:${offerId}` },
    });

    return NextResponse.json({
      success: true,
      offerId,
      sku: preflight.sku,
      title: preflight.title,
      priceGbp: preflight.priceGbp,
      policySummary: preflight.policySummary,
      message: "eBay offer created. Review and publish when ready.",
    });
  } catch (err) {
    if (isEbayApiError(err)) {
      console.error("[ebay] offer creation failed", ebayApiErrorLogBody(err));
    }
    return NextResponse.json(
      ebayApiErrorResponseBody(err, "eBay offer creation failed"),
      { status: 500 },
    );
  }
}
