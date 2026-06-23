export type LaunchPlanState = "next" | "warn" | "done";
export type LaunchPlanTarget = "buy" | "stock" | "listings" | "profit" | "watches" | "external";

export interface LaunchPlanInput {
  stockCount: number;
  draftListings: number;
  activeListings: number;
  soldCount: number;
  activeWatches: number;
  operatingExpensePence: number;
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

export function buildLaunchPlan(input: LaunchPlanInput, limit = 5): LaunchPlanItem[] {
  const items: LaunchPlanItem[] = [];

  if (input.stockCount === 0) {
    items.push({
      id: "first-stock",
      title: "Stock first buys",
      detail: "Use checked comps for the first three cards.",
      state: "next",
      action: "Buy",
      target: "buy",
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

  if (!input.secondaryCrossCheck) {
    items.push({
      id: "second-source",
      title: "Add second comp source",
      detail: "PokeTrace is still missing, so bigger raw buys need manual checking.",
      state: "warn",
      action: "Setup",
      target: "external",
      priority: 60,
    });
  }

  if (!input.alertDelivery) {
    items.push({
      id: "discord-alerts",
      title: "Turn on alerts",
      detail: "Discord webhook is missing; reprices and buy hits stay in-app.",
      state: "warn",
      action: "Setup",
      target: "external",
      priority: 52,
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

function planRank(state: LaunchPlanState): number {
  if (state === "next") return 3;
  if (state === "warn") return 2;
  return 1;
}
