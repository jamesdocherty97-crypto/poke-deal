export type ListingWorkflowChannel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";

export interface ListingWorkflowItem {
  id: string;
  state: string;
  item?: { status?: string } | unknown | null;
}

export interface ListingVenueAction {
  label: string;
  url: string;
  openedLabel: string;
}

export type ListingFlowStepState = "done" | "current" | "next" | "blocked";

export interface ListingFlowStep {
  id: string;
  label: string;
  detail: string;
  state: ListingFlowStepState;
}

export interface ListingSellFlowInput {
  channel: ListingWorkflowChannel;
  state: string;
  externalRef?: string | null;
  ebayReady?: boolean;
  sellable?: boolean;
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

export function listingVenueAction(
  channel: ListingWorkflowChannel,
  options: { query?: string } = {},
): ListingVenueAction | null {
  if (channel === "EBAY") {
    return {
      label: "Open eBay Sell",
      url: "https://www.ebay.co.uk/sl/sell",
      openedLabel: "eBay Sell",
    };
  }

  if (channel === "CARDMARKET") {
    const params = new URLSearchParams();
    const query = options.query?.trim();
    if (query) params.set("searchString", query);
    return {
      label: "Open Cardmarket",
      url: `https://www.cardmarket.com/en/Pokemon/Products/Search${params.size ? `?${params.toString()}` : ""}`,
      openedLabel: "Cardmarket",
    };
  }

  if (channel === "VINTED") {
    return {
      label: "Open Vinted",
      url: "https://www.vinted.co.uk/items/new",
      openedLabel: "Vinted upload",
    };
  }

  return null;
}

export function buildListingSellFlow(input: ListingSellFlowInput): ListingFlowStep[] {
  if (input.channel === "EBAY") return buildEbaySellFlow(input);
  return buildManualSellFlow(input);
}

function buildEbaySellFlow(input: ListingSellFlowInput): ListingFlowStep[] {
  const sold = input.state === "SOLD" || input.sellable === false;
  const hasOffer = Boolean(input.externalRef?.startsWith("offer:"));
  const published = Boolean(input.externalRef && !input.externalRef.startsWith("offer:"));

  return [
    {
      id: "review",
      label: "Review pack",
      detail: "Check title, price, image and specifics.",
      state: hasOffer || published || sold ? "done" : "current",
    },
    {
      id: "offer",
      label: "Create offer",
      detail: "Create the eBay offer without publishing live.",
      state: hasOffer || published || sold ? "done" : input.ebayReady ? "current" : "blocked",
    },
    {
      id: "publish",
      label: "Publish live",
      detail: "Final confirmation before it appears on eBay.",
      state: published || sold ? "done" : hasOffer ? "current" : "next",
    },
    {
      id: "sale",
      label: "Book sale",
      detail: "Record price, fees and postage when it sells.",
      state: sold ? "done" : published || input.state === "ACTIVE" ? "current" : "next",
    },
  ];
}

function buildManualSellFlow(input: ListingSellFlowInput): ListingFlowStep[] {
  const sold = input.state === "SOLD" || input.sellable === false;
  const active = input.state === "ACTIVE";

  return [
    {
      id: "copy",
      label: "Copy pack",
      detail: "Use the title, price, specifics and description.",
      state: active || sold ? "done" : "current",
    },
    {
      id: "activate",
      label: "Mark active",
      detail: "Track the listing after it is posted or shared.",
      state: active || sold ? "done" : "next",
    },
    {
      id: "sale",
      label: "Book sale",
      detail: "Record price, fees and postage when it sells.",
      state: sold ? "done" : active ? "current" : "next",
    },
  ];
}

function hasSellableItem(item: ListingWorkflowItem["item"]): boolean {
  if (!item) return false;
  if (typeof item === "object" && "status" in item && item.status === "SOLD") return false;
  return true;
}
