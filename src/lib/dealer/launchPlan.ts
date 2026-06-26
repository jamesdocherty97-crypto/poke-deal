export type LaunchPlanState = "next" | "warn" | "done";
export type LaunchPlanTarget = "buy" | "opening-stock" | "stock" | "listings" | "profit" | "watches" | "external";

export interface LaunchPlanInput {
  stockCount: number;
  draftListings: number;
  activeListings: number;
  soldCount: number;
  activeWatches: number;
  operatingExpensePence: number;
  setupKnown?: boolean;
  secondaryCrossCheck: boolean;
  alertDelivery: boolean;
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

  if (input.stockCount === 0) {
    items.push({
      id: "first-stock",
      title: "Load first stock",
      detail: "Paste opening stock, or comp a fresh buy if you are starting from zero.",
      state: "next",
      action: "Import",
      target: "opening-stock",
      priority: 100,
    });
  }

  if (input.stockCount > 0 && input.draftListings + input.activeListings === 0) {
    items.push({
      id: "first-listings",
      title: "Create first listings",
      detail: `${input.stockCount} stocked card${input.stockCount === 1 ? "" : "s"} need a selling channel.`,
      state: "next",
      action: "Stock",
      target: "stock",
      priority: 92,
    });
  } else if (input.draftListings > 0) {
    items.push({
      id: "activate-drafts",
      title: "Activate drafts",
      detail: `${input.draftListings} draft listing${input.draftListings === 1 ? "" : "s"} can go live or export.`,
      state: "next",
      action: "List",
      target: "listings",
      priority: 92,
    });
  }

  if (input.activeListings > 0 && input.soldCount === 0) {
    items.push({
      id: "first-sale",
      title: "Book first sale",
      detail: "Record fees and postage so true profit starts clean.",
      state: "next",
      action: "Sell",
      target: "listings",
      priority: 84,
    });
  }

  if (input.operatingExpensePence === 0) {
    items.push({
      id: "setup-costs",
      title: "Log setup costs",
      detail: "Sleeves, postage, table fees, grading and travel affect net profit.",
      state: "next",
      action: "Costs",
      target: "profit",
      priority: 76,
    });
  }

  if (input.activeWatches === 0) {
    items.push({
      id: "source-target",
      title: "Set a buy target",
      detail: "Track one chase card below your buy price.",
      state: "next",
      action: "Target",
      target: "watches",
      priority: 68,
    });
  }

  const setupKnown = input.setupKnown ?? true;

  if (setupKnown && !input.secondaryCrossCheck) {
    items.push({
      id: "second-source",
      title: "Add second comp source",
      detail: "Finish a live cross-check source before trusting bigger raw buys without a manual sold check.",
      state: "warn",
      action: "Setup",
      target: "external",
      priority: 60,
    });
  }

  if (input.stockCount > 0 && input.activeListings > 0 && input.soldCount > 0 && input.operatingExpensePence > 0) {
    items.push({
      id: "weekly-rhythm",
      title: "Weekly rhythm",
      detail: "Snapshot stock value, check reprices, export books.",
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
  const setupKnown = input.setupKnown ?? true;
  const milestones = [
    { done: input.stockCount > 0, label: "stock ledger" },
    { done: input.draftListings + input.activeListings > 0, label: "listing pipeline" },
    { done: input.soldCount > 0, label: "first sale" },
    { done: input.operatingExpensePence > 0, label: "costs" },
    { done: input.activeWatches > 0, label: "buy target" },
    { done: !setupKnown || input.secondaryCrossCheck, label: "comp cross-check" },
  ];
  const doneCount = milestones.filter((milestone) => milestone.done).length;
  const next = milestones.find((milestone) => !milestone.done);

  return {
    doneCount,
    totalCount: milestones.length,
    label: `${doneCount}/${milestones.length} ready`,
    nextLabel: next ? `Next: ${next.label}` : "Ready for weekly rhythm",
  };
}

function planRank(state: LaunchPlanState): number {
  if (state === "next") return 3;
  if (state === "warn") return 2;
  return 1;
}
