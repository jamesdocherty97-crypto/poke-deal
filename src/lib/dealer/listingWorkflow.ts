export type ListingWorkflowChannel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";

export interface ListingWorkflowItem {
  id: string;
  state: string;
  item?: { status?: string } | unknown | null;
}

export interface ListingVenueAction {
  label: string;
  url: string;
}

export function nextDraftListingId(
  listings: ListingWorkflowItem[],
  currentId: string | null | undefined,
): string | null {
  const draftIds = listings
    .filter((listing) => listing.state === "DRAFT" && Boolean(listing.item))
    .map((listing) => listing.id);
  if (draftIds.length === 0) return null;
  if (!currentId) return draftIds[0] ?? null;

  const currentIndex = draftIds.indexOf(currentId);
  if (currentIndex < 0) return draftIds[0] ?? null;
  if (draftIds.length <= 1) return null;
  return draftIds[(currentIndex + 1) % draftIds.length] ?? null;
}

export function nextSaleListingId(
  listings: ListingWorkflowItem[],
  currentId: string | null | undefined,
): string | null {
  const activeIds = listings
    .filter((listing) => listing.state === "ACTIVE" && hasSellableItem(listing.item))
    .map((listing) => listing.id);
  if (activeIds.length === 0) return null;
  if (!currentId) return activeIds[0] ?? null;

  const currentIndex = activeIds.indexOf(currentId);
  if (currentIndex < 0) return activeIds[0] ?? null;
  if (activeIds.length <= 1) return null;
  return activeIds[(currentIndex + 1) % activeIds.length] ?? null;
}

export function listingVenueAction(channel: ListingWorkflowChannel): ListingVenueAction | null {
  if (channel !== "EBAY") return null;
  return {
    label: "Open eBay Sell",
    url: "https://www.ebay.co.uk/sl/sell",
  };
}

function hasSellableItem(item: ListingWorkflowItem["item"]): boolean {
  if (!item) return false;
  if (typeof item === "object" && "status" in item && item.status === "SOLD") return false;
  return true;
}
