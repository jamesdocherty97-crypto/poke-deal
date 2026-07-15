import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { getEbayConfig, isEbayConfigured } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { fetchEbayPolicies } from "@/lib/ebay/policies";
import { buildEbayOfferPreflight } from "@/lib/ebay/preflight";
import { synchronizeEbayOffer, validateEbayListPricePence } from "@/lib/ebay/offerSync";
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

  const priceError = validateEbayListPricePence(listing.listPrice);
  if (priceError) {
    return NextResponse.json(
      { error: priceError },
      { status: 400 },
    );
  }
  const listPricePence = listing.listPrice!;

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
      listPricePence,
      condition: listing.item.condition ?? undefined,
      certNumber: listing.item.graderCert ?? undefined,
      usesCatalogOnlyImages: false,
    };
    const photoSummary = summarizeListingPhotos({
      photos: listing.item.photos,
      grade: listing.item.grade,
      pricePence: listPricePence,
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
      title: listing.title,
      titleCustomized: listing.titleCustomized,
      description: listing.description,
      packInput,
      quantity: listing.item.quantity ?? 1,
      imageUrls: photoSummary.imageUrls,
      policies,
      config,
    });

    const storedOfferId = listing.ebayOfferId
      ?? (listing.externalRef?.startsWith("offer:")
        ? listing.externalRef.slice("offer:".length)
        : null);
    const synced = await synchronizeEbayOffer({
      config,
      accessToken,
      preflight,
      listPricePence,
      offerId: storedOfferId,
    });

    // Keep the offer ID after publish too: eBay uses it for later live revisions.
    await prisma.listing.update({
      where: { id: params.id },
      data: {
        externalRef: `offer:${synced.offerId}`,
        ebayOfferId: synced.offerId,
        offerSyncedAt: new Date(),
        offerSyncedPrice: synced.syncedPricePence,
        title: preflight.title,
      },
    });

    return NextResponse.json({
      success: true,
      offerId: synced.offerId,
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
