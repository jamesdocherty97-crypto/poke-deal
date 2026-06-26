export type TodayActionTarget = "buy" | "opening-stock" | "stock" | "drafts" | "sales" | "profit" | "watches" | "reprice";

export type TodayActionTone = "good" | "warn" | "info";

export interface TodayActionInput {
  stockCount: number;
  activeStockCount: number;
  soldCount: number;
  draftListings: number;
  activeListings: number;
  activeWatches: number;
  agedStockCount: number;
  unlistedStockCount: number;
}

export interface TodayAction {
  id: string;
  title: string;
  detail: string;
  target: TodayActionTarget;
  tone: TodayActionTone;
  priority: number;
}

export function buildTodayActions(input: TodayActionInput, limit = 5): TodayAction[] {
  const actions: TodayAction[] = [];

  if (input.stockCount === 0) {
    actions.push({
      id: "opening-stock",
      title: "Load opening stock",
      detail: "Paste existing cards in one go",
      target: "opening-stock",
      tone: "good",
      priority: 104,
    });

    actions.push({
      id: "first-buy",
      title: "Add first buy",
      detail: "Comp and stock one card",
      target: "buy",
      tone: "good",
      priority: 100,
    });
  }

  if (input.draftListings > 0) {
    actions.push({
      id: "draft-listings",
      title: `${input.draftListings} draft listing${input.draftListings === 1 ? "" : "s"}`,
      detail: "Ready to activate or export",
      target: "drafts",
      tone: "good",
      priority: 92,
    });
  }

  if (input.unlistedStockCount > 0) {
    actions.push({
      id: "unlisted-stock",
      title: `${input.unlistedStockCount} stock row${input.unlistedStockCount === 1 ? "" : "s"} not listed`,
      detail: "Draft listing packs",
      target: "drafts",
      tone: "warn",
      priority: 88,
    });
  }

  if (input.activeListings > 0) {
    actions.push({
      id: "reprice",
      title: "Check repricing",
      detail: `${input.activeListings} active listing${input.activeListings === 1 ? "" : "s"}`,
      target: "reprice",
      tone: "info",
      priority: 72,
    });
  }

  if (input.agedStockCount > 0) {
    actions.push({
      id: "aged-stock",
      title: `${input.agedStockCount} ageing stock row${input.agedStockCount === 1 ? "" : "s"}`,
      detail: "Review price or channel",
      target: "profit",
      tone: "warn",
      priority: 70,
    });
  }

  if (input.stockCount > 0 && input.soldCount === 0) {
    actions.push({
      id: "first-sale",
      title: "Book first sale",
      detail: input.activeListings > 0 ? "Sell from active listings" : "Profit starts after a sold item",
      target: input.activeListings > 0 ? "sales" : "stock",
      tone: "good",
      priority: 64,
    });
  }

  if (input.stockCount > 0) {
    actions.push({
      id: "comp-next-buy",
      title: "Comp next buy",
      detail: "Fast lookup for the next card",
      target: "buy",
      tone: "info",
      priority: 62,
    });
  }

  if (input.activeWatches === 0) {
    actions.push({
      id: "buy-target",
      title: "Set buy target",
      detail: "Track a card below your price",
      target: "watches",
      tone: "info",
      priority: input.stockCount === 0 ? 48 : 60,
    });
  }

  return actions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, Math.max(1, limit));
}
