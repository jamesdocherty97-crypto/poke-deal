import { normalizeListingRawCondition } from "./listingPack.js";
import { summarizeListingPhotos, type ListingPhoto } from "../photos/listingPhotoPolicy.js";

export type InventoryFilter = "needs-action" | "all" | "needs-listing" | "drafts" | "listed" | "needs-photos" | "held" | "sold";

type StockListing = {
  state: string;
  channel: string;
  listPrice?: number | null;
  externalRef?: string | null;
  externalUrl?: string | null;
};

export type StockReadinessItem = {
  status: string;
  grade: string;
  condition?: string | null;
  listings: readonly StockListing[];
  photos?: readonly ListingPhoto[];
  quantity?: number;
  /** Remaining copies after local sale reservations; null means not yet confirmed. */
  localAvailableQuantity?: number | null;
};

/** A saved draft is preparation, never proof that buyers can see the card. */
export function hasLiveListing(item: Pick<StockReadinessItem, "listings">): boolean {
  return item.listings.some((listing) => listing.state === "ACTIVE" && (
    listing.channel === "IN_PERSON" || Boolean(listing.externalUrl?.trim() || (listing.externalRef?.trim() && !listing.externalRef.startsWith("offer:")))
  ));
}

export function stockReadiness(item: StockReadinessItem) {
  const live = hasLiveListing(item);
  const draft = item.listings.some((listing) => listing.state === "DRAFT");
  const listing = item.listings.find((row) => row.state === "ACTIVE") ?? item.listings.find((row) => row.state === "DRAFT");
  const needsCondition = item.grade === "RAW" && !normalizeListingRawCondition(item.condition);
  const needsPrice = !listing || !(listing.listPrice != null && listing.listPrice > 0);
  const needsPhotos = listing?.channel === "IN_PERSON" ? false : listing?.channel === "EBAY"
    ? !summarizeListingPhotos({ photos: item.photos ?? [], grade: item.grade, pricePence: listing.listPrice }).satisfiesEbayPhotoRequirement
    : !(item.photos ?? []).some((photo) => Boolean(photo.url?.trim()));
  const sold = item.status === "SOLD";
  const locallyUnavailable = !sold && item.localAvailableQuantity !== undefined &&
    !(Number.isSafeInteger(item.localAvailableQuantity) && Number(item.localAvailableQuantity) > 0);
  const localSalePending = !sold && typeof item.localAvailableQuantity === "number" &&
    Number.isSafeInteger(item.localAvailableQuantity) && item.localAvailableQuantity >= 0 &&
    (item.localAvailableQuantity === 0 || (item.quantity !== undefined && item.localAvailableQuantity !== item.quantity));
  const held = !sold && (item.status === "RESERVED" || locallyUnavailable || localSalePending);
  const next = sold ? "Sold" : localSalePending ? "Sync sale" : locallyUnavailable ? "Check queued sales" : held ? "On hold" : needsCondition ? "Check condition" : needsPhotos ? "Add photos"
    : needsPrice ? "Set your price" : !live ? draft ? "Publish draft" : "Confirm live listing" : "Live";
  return { live, draft, needsCondition, needsPrice, needsPhotos, held, sold, locallyUnavailable, localSalePending, next,
    needsAction: !sold && (localSalePending || locallyUnavailable || (!held && (!live || needsCondition || needsPrice || needsPhotos))) };
}

export function inventoryItemMatchesFilter(item: StockReadinessItem, filter: InventoryFilter): boolean {
  const readiness = stockReadiness(item);
  if (filter === "sold") return readiness.sold;
  if (readiness.sold) return false;
  if (filter === "all") return true;
  if (readiness.locallyUnavailable || readiness.localSalePending) return filter === "held" || filter === "needs-action";
  if (filter === "needs-action") return readiness.needsAction;
  if (filter === "needs-listing") return !readiness.held && !readiness.live;
  if (filter === "drafts") return readiness.draft;
  if (filter === "listed") return readiness.live;
  if (filter === "needs-photos") return readiness.needsPhotos;
  return readiness.held;
}

export function emptyInventoryFilterText(filter: InventoryFilter): string {
  if (filter === "needs-action") return "Your active squad is ready — no preparation tasks waiting.";
  if (filter === "needs-listing") return "Every available card has a live listing.";
  if (filter === "drafts") return "No draft listings waiting.";
  if (filter === "listed") return "No confirmed live listings yet. Drafts are waiting to be published.";
  if (filter === "needs-photos") return "Your cards have the photos required for their channel.";
  if (filter === "held") return "No stock is on hold.";
  if (filter === "sold") return "No sold stock yet.";
  return "No stock in this view.";
}
