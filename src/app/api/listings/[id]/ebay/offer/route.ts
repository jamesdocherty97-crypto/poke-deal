import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { getEbayConfig, isEbayConfigured } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { fetchEbayPolicies } from "@/lib/ebay/policies";
import { buildInventoryItemPayload, upsertInventoryItem } from "@/lib/ebay/inventoryItem";
import { buildListingPack } from "@/lib/dealer/listingPack";
import { buildOfferPayload, createEbayOffer, getOfferBySku } from "@/lib/ebay/offer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stable SKU derived from our internal listing ID. */
function toSku(listingId: string): string {
  return `pdos-${listingId}`;
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  if (!isEbayConfigured()) {
    return NextResponse.json(
      { error: "eBay is not configured. Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME." },
      { status: 503 },
    );
  }

  const prisma = getPrisma();
  const listing = await prisma.listing.findUnique({
    where: { id: params.id },
    include: { item: { include: { card: true } } },
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
    };

    const pack = buildListingPack(packInput);
    const sku = toSku(params.id);

    // Upsert the inventory item (idempotent — safe to call multiple times)
    const inventoryPayload = buildInventoryItemPayload(
      packInput,
      listing.item.quantity ?? 1,
      listing.item.card.imageUrl ?? undefined,
    );
    await upsertInventoryItem(config, sku, inventoryPayload, accessToken);

    // Use existing offer if one already exists for this SKU
    let offerId = await getOfferBySku(config, sku, accessToken);
    if (!offerId) {
      const offerPayload = buildOfferPayload(sku, pack, policies, config, listing.item.quantity ?? 1);
      const created = await createEbayOffer(config, offerPayload, accessToken);
      offerId = created.offerId;
    }

    // Persist offer ID with prefix so we can distinguish it from a published listing ID
    await prisma.listing.update({
      where: { id: params.id },
      data: { externalRef: `offer:${offerId}` },
    });

    return NextResponse.json({
      success: true,
      offerId,
      sku,
      title: pack.title,
      priceGbp: (pack.suggestedPricePence / 100).toFixed(2),
      message: "eBay offer created. Review and publish when ready.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "eBay offer creation failed" },
      { status: 500 },
    );
  }
}
