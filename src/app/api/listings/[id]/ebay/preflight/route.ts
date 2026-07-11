import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { getEbayConfig, isEbayConfigured } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { fetchEbayPolicies } from "@/lib/ebay/policies";
import { getOfferBySku } from "@/lib/ebay/offer";
import { buildEbayOfferPreflight, toEbaySku } from "@/lib/ebay/preflight";
import { ebayApiErrorLogBody, ebayApiErrorResponseBody, isEbayApiError } from "@/lib/ebay/errors";
import { summarizeListingPhotos } from "@/lib/photos/listingPhotoPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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
    const sku = toEbaySku(params.id, listing.itemId);
    const existingOfferId = await getOfferBySku(config, sku, accessToken);

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
    packInput.usesCatalogOnlyImages = photoSummary.catalogOnly && photoSummary.satisfiesEbayPhotoRequirement;

    const preflight = buildEbayOfferPreflight({
      listingId: params.id,
      itemId: listing.itemId,
      packInput,
      quantity: listing.item.quantity ?? 1,
      imageUrls: photoSummary.satisfiesEbayPhotoRequirement ? photoSummary.imageUrls : [],
      policies,
      config,
    });

    return NextResponse.json({
      success: true,
      writesToEbay: false,
      existingOfferId,
      ...preflight,
    });
  } catch (err) {
    if (isEbayApiError(err)) {
      console.error("[ebay] preflight failed", ebayApiErrorLogBody(err));
    }
    return NextResponse.json(
      ebayApiErrorResponseBody(err, "eBay preflight failed"),
      { status: 500 },
    );
  }
}
