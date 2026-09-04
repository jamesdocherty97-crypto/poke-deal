type ListingChannel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";

export interface SaleListingRecord {
  id: string;
  channel: ListingChannel;
  state: string;
}

/** A sale is evidence for its own listing, never proof that another venue ended. */
export function planSaleListingUpdates(input: {
  listings: SaleListingRecord[];
  soldListingId?: string | null;
  soldChannel: ListingChannel;
  fullySold: boolean;
}) {
  const open = input.listings.filter((listing) => listing.state === "ACTIVE" || listing.state === "DRAFT");
  const candidates = open.filter((listing) => listing.channel === input.soldChannel);
  const soldListing = input.soldListingId
    ? candidates.find((listing) => listing.id === input.soldListingId)
    : candidates.filter((listing) => listing.state === "ACTIVE").length === 1
      ? candidates.find((listing) => listing.state === "ACTIVE")
      : undefined;
  const otherExternal = open.filter((listing) =>
    listing.state === "ACTIVE" && listing.channel !== "IN_PERSON" && listing.id !== soldListing?.id,
  );

  return {
    soldListingIds: input.fullySold && soldListing ? [soldListing.id] : [],
    endedListingIds: input.fullySold
      ? open.filter((listing) => listing.id !== soldListing?.id &&
        (listing.state === "DRAFT" || listing.channel === "IN_PERSON")).map((listing) => listing.id)
      : [],
    externalAttentionIds: otherExternal.map((listing) => listing.id),
  };
}

export function listingStockAttention(listing: {
  state: string;
  channel: string;
  item?: { status?: string } | null;
}): boolean {
  return listing.state === "ACTIVE" && listing.channel !== "IN_PERSON" && listing.item?.status === "SOLD";
}
