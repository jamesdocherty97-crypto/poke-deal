import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { getEbayConfig, isEbayConfigured } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { publishEbayOffer } from "@/lib/ebay/offer";
import { fetchEbaySellingPrivileges } from "@/lib/ebay/policies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ebayListingUrl(listingId: string): string {
  return `https://www.ebay.co.uk/itm/${listingId}`;
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  if (!isEbayConfigured()) {
    return NextResponse.json(
      { error: "eBay is not configured." },
      { status: 503 },
    );
  }

  const prisma = getPrisma();
  const listing = await prisma.listing.findUnique({
    where: { id: params.id },
    include: { item: true },
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

  const offerId = listing.externalRef?.startsWith("offer:")
    ? listing.externalRef.slice("offer:".length)
    : null;

  if (!offerId) {
    return NextResponse.json(
      { error: "No pending eBay offer found. Create an offer first." },
      { status: 400 },
    );
  }

  const config = getEbayConfig()!;

  try {
    const accessToken = await getAccessToken(config);
    const privileges = await fetchEbaySellingPrivileges(config, accessToken);
    if (privileges.sellerRegistrationCompleted === false) {
      return NextResponse.json(
        {
          error:
            "eBay has not marked this seller account fully ready yet. You can create offers, but live publish is blocked until seller registration/payments onboarding is complete in eBay.",
        },
        { status: 409 },
      );
    }

    const result = await publishEbayOffer(config, offerId, accessToken);
    const listingId = result.listingId;
    const listingUrl = ebayListingUrl(listingId);

    await prisma.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id: params.id },
        data: {
          state: "ACTIVE",
          externalRef: listingId,
          externalUrl: listingUrl,
          listedAt: new Date(),
        },
      });
      if (listing.item.status !== "SOLD") {
        await tx.inventoryItem.update({
          where: { id: listing.itemId },
          data: { status: "LISTED" },
        });
      }
    });

    return NextResponse.json({
      success: true,
      listingId,
      listingUrl,
      message: "Listing published on eBay.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "eBay publish failed" },
      { status: 500 },
    );
  }
}
