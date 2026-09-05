import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { ebayListingIdFromUrl } from "@/lib/dealer/listingUrl";
import { getEbayConfig } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { toEbaySku } from "@/lib/ebay/preflight";
import { LiveEbayEditError, readLiveEbayOfferSnapshot } from "@/lib/ebay/liveOfferEdit";
import { ebayApiErrorResponseBody } from "@/lib/ebay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read buyer-visible fields before opening an editor; never use a stale copy as live evidence. */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const listing = await getPrisma().listing.findUnique({
      where: { id },
      include: { item: true },
    });
    if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404, headers });
    if (listing.channel !== "EBAY" || listing.state !== "ACTIVE" || !listing.ebayOfferId) {
      return NextResponse.json({ error: "This listing has no linked live eBay offer. Open it on eBay to edit it." }, { status: 409, headers });
    }
    if (listing.item.status === "SOLD" || listing.item.quantity < 1) {
      return NextResponse.json({ error: "This card is sold. Remove its live listing instead of editing it." }, { status: 409, headers });
    }
    const itemId = ebayListingIdFromUrl(listing.externalUrl);
    if (!itemId || itemId !== listing.externalRef) {
      return NextResponse.json({ error: "The saved eBay link and item reference do not match. Check the listing on eBay." }, { status: 409, headers });
    }
    const config = getEbayConfig();
    if (!config) return NextResponse.json({ error: "eBay is not connected. Reconnect it in Setup, then try again." }, { status: 503, headers });
    const snapshot = await readLiveEbayOfferSnapshot({
      config,
      accessToken: await getAccessToken(config),
      offerId: listing.ebayOfferId,
      listingId: itemId,
      sku: toEbaySku(listing.id, listing.itemId),
    });
    return NextResponse.json(snapshot, { headers });
  } catch (error) {
    return NextResponse.json(ebayApiErrorResponseBody(error, "Could not read the live listing. Try again."), {
      status: error instanceof LiveEbayEditError ? error.status : 502,
      headers,
    });
  }
}
