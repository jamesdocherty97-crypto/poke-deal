export type LaunchPlanState = "next" | "warn" | "done";
export type LaunchPlanTarget = "buy" | "opening-stock" | "stock" | "listings" | "profit" | "watches" | "external";

export interface LaunchPlanInput {
  stockCount: number;
  sellableStockCount?: number;
  draftListings: number;
  /** Drafts with confirmed condition, required photos and an explicit price. */
  preparedDrafts?: number;
  activeListings: number;
  /** Retained listing history that was confirmed live before it ended or sold. */
  previouslyLiveListings?: number;
  soldCount: number;
  activeWatches: number;
  operatingExpensePence: number;
  setupKnown?: boolean;
  secondaryCrossCheck: boolean;
  alertDelivery: boolean;
}

export function summarizeSellingStock(items: readonly StockReadinessItem[]) {
  const rows = items.map((item) => ({ item, readiness: stockReadiness(item) }));
  const available = rows.filter(({ readiness }) => !readiness.sold && !readiness.held);
  return {
    totalRows: items.length,
    availableRows: available.length,
    heldRows: rows.filter(({ readiness }) => readiness.held).length,
    preparationRows: available.filter(({ readiness }) => readiness.needsCondition || readiness.needsPhotos || readiness.needsPrice).length,
    preparedDrafts: available.filter(({ readiness }) => readiness.draft && !readiness.live &&
      !readiness.needsCondition && !readiness.needsPhotos && !readiness.needsPrice).length,
    liveRows: available.filter(({ readiness }) => readiness.live).length,
    removalListings: rows.filter(({ readiness }) => readiness.sold).reduce((sum, { item }) =>
      sum + item.listings.filter((listing) => listing.state === "ACTIVE" && listing.channel !== "IN_PERSON").length, 0),
  };
}

export function buildSellingMission(stock: ReturnType<typeof summarizeSellingStock>, soldCount: number): {
  title: string; detail: string; action: string; target: "opening-stock" | "stock" | "drafts" | "listings" | "profit";
} {
  if (stock.removalListings > 0) return {
    title: `Remove ${stock.removalListings} sold listing${stock.removalListings === 1 ? "" : "s"}`,
    detail: "These cards have sold, but another marketplace listing may still be live. Remove it before it sells again.",
    action: "Review live listings", target: "listings",
  };
  if (stock.preparedDrafts > 0) return {
    title: `Publish ${Math.min(5, stock.preparedDrafts)} prepared draft${Math.min(5, stock.preparedDrafts) === 1 ? "" : "s"}`,
    detail: "Condition, photos and price are recorded. Review the listing, publish it and verify buyers can see it.",
    action: "Open listing desk", target: "drafts",
  };
  if (stock.preparationRows > 0) return {
    title: `Prepare ${Math.min(5, stock.preparationRows)} single${Math.min(5, stock.preparationRows) === 1 ? "" : "s"} for sale`,
    detail: "Choose a small batch from your stock. Check each physical card, add the photos it needs and set your asking price.",
    action: "Prepare stock", target: "stock",
  };
  if (stock.liveRows > 0) return {
    title: "Work your live listings",
    detail: `${stock.liveRows} stock row${stock.liveRows === 1 ? " is" : "s are"} live. Check paid orders, refresh weak listings and record actual sale costs.`,
    action: "Review live listings", target: "listings",
  };
  if (stock.availableRows > 0) return {
    title: "Get your next single in front of buyers",
    detail: "Check your saved drafts and confirm a real live listing. Preparing or exporting a pack does not publish it.",
    action: "Open listing desk", target: "drafts",
  };
  if (stock.heldRows > 0) return {
    title: "Review your held stock",
    detail: "Check reservations and pending sales before making these cards available to another buyer.",
    action: "Open stock vault", target: "stock",
  };
  if (soldCount > 0) return {
    title: "Review sales before replenishing",
    detail: "Confirm actual costs, finish dispatch in the marketplace and use completed sales to choose your next stock.",
    action: "Review sales", target: "profit",
  };
  return {
    title: "Load your existing singles",
    detail: "Start your selling quest with the cards you already own. Import them, then prepare a small batch for buyers.",
    action: "Import stock", target: "opening-stock",
  };
}

export interface LaunchPlanItem {
  id: string;
  title: string;
  detail: string;
  state: LaunchPlanState;
  action: string;
  target: LaunchPlanTarget;
  priority: number;
}

export interface LaunchProgress {
  doneCount: number;
  totalCount: number;
  label: string;
  nextLabel: string;
}

export function buildLaunchPlan(input: LaunchPlanInput, limit = 5): LaunchPlanItem[] {
  const items: LaunchPlanItem[] = [];
  const sellableStockCount = input.sellableStockCount ?? input.stockCount;

  if (input.stockCount === 0 && input.soldCount === 0) {
    items.push({
      id: "first-stock",
      title: "Load your existing singles",
      detail: "Start with the physical cards you can sell. Check condition, printing and where each copy is stored.",
      state: "next",
      action: "Import",
      target: "opening-stock",
      priority: 100,
    });
  }

  if (sellableStockCount > 0 && input.draftListings + input.activeListings === 0) {
    items.push({
      id: "first-listings",
      title: "Prepare your first selling batch",
      detail: `${sellableStockCount} stock row${sellableStockCount === 1 ? "" : "s"}. Choose a small batch, confirm condition, add photos and set your price.`,
      state: "next",
      action: "Stock",
      target: "stock",
      priority: 92,
    });
  } else if (sellableStockCount > 0 && input.draftListings > 0) {
    items.push({
      id: "activate-drafts",
      title: (input.preparedDrafts ?? 0) > 0 ? "Publish prepared drafts" : "Finish your listing drafts",
      detail: (input.preparedDrafts ?? 0) > 0
        ? `${input.preparedDrafts} prepared draft${input.preparedDrafts === 1 ? "" : "s"}. Publish and verify the marketplace listing; an export alone is not live.`
        : `${input.draftListings} draft${input.draftListings === 1 ? "" : "s"}. Review condition, photos and your asking price before publishing.`,
      state: "next",
      action: "List",
      target: "listings",
      priority: 92,
    });
  }

  if (sellableStockCount > 0 && input.activeListings > 0 && input.soldCount === 0) {
    items.push({
      id: "first-sale",
      title: "Work towards your first paid sale",
      detail: "Check live presentation and pricing. Record a sale only after the buyer pays, then dispatch through the marketplace.",
      state: "next",
      action: "Review live",
      target: "listings",
      priority: 84,
    });
  }

  if ((input.stockCount > 0 || input.soldCount > 0) && input.operatingExpensePence === 0) {
    items.push({
      id: "setup-costs",
      title: "Log setup costs",
      detail: "If you have paid for sleeves, table fees, grading or travel, record those costs. This does not block listing.",
      state: "next",
      action: "Costs",
      target: "profit",
      priority: 76,
    });
  }

  if (input.soldCount > 0) {
    items.push({
      id: "weekly-rhythm",
      title: "Review sales and replenish deliberately",
      detail: "Confirm actual costs, review unsold listings, then use completed sales to choose the next stock.",
      state: "done",
      action: "Profit",
      target: "profit",
      priority: 44,
    });
  }

  return items
    .sort((left, right) => planRank(right.state) - planRank(left.state) || right.priority - left.priority)
    .slice(0, Math.max(1, limit));
}

export function buildLaunchProgress(input: LaunchPlanInput): LaunchProgress {
  const hasLiveHistory = input.activeListings > 0 || (input.previouslyLiveListings ?? 0) > 0;
  const milestones = [
    { done: input.stockCount > 0 || input.soldCount > 0, label: "stock recorded" },
    { done: (input.preparedDrafts ?? 0) > 0 || hasLiveHistory, label: "a prepared listing" },
    { done: hasLiveHistory, label: "a live listing" },
    { done: input.soldCount > 0, label: "a completed sale" },
  ];
  const doneCount = milestones.filter((milestone) => milestone.done).length;
  const next = milestones.find((milestone) => !milestone.done);

  return {
    doneCount,
    totalCount: milestones.length,
    label: `${doneCount}/${milestones.length} milestones`,
    nextLabel: next ? `Next: ${next.label}` : "First-sale quest complete",
  };
}

function planRank(state: LaunchPlanState): number {
  if (state === "next") return 3;
  if (state === "warn") return 2;
  return 1;
}
import { stockReadiness, type StockReadinessItem } from "./stockReadiness.js";
