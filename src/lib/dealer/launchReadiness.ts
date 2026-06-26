export type LaunchReadinessState = "done" | "next" | "warn";
export type LaunchReadinessTarget = "buy" | "opening-stock" | "stock" | "listings" | "profit" | "watches" | "external";

export interface LaunchReadinessInput {
  livePrimaryComps: boolean;
  liveCatalogKey: boolean;
  secondaryCrossCheck: boolean;
  ebayConfigured?: boolean;
  ebayConnected?: boolean;
  ebayHasPolicies?: boolean;
  ebayHasMerchantLocation?: boolean;
  alertDelivery: boolean;
  stockCount: number;
  draftListings: number;
  activeListings: number;
  soldCount: number;
  activeWatches: number;
  operatingExpensePence: number;
}

export interface LaunchReadinessItem {
  id: string;
  title: string;
  detail: string;
  state: LaunchReadinessState;
  action?: string;
  target?: LaunchReadinessTarget;
  priority: number;
}

export function buildLaunchReadiness(input: LaunchReadinessInput): LaunchReadinessItem[] {
  const items: LaunchReadinessItem[] = [
    buildCompReadiness(input),
    buildCrossCheckReadiness(input),
    buildEbayReadiness(input),
    buildListingReadiness(input),
    buildSaleReadiness(input),
    buildAlertReadiness(input),
    buildWatchReadiness(input),
    buildCostReadiness(input),
  ];

  if (input.stockCount === 0) {
    items.push({
      id: "first-buy",
      title: "First buy",
      detail: "Add a card to start the stock ledger.",
      state: "next",
      action: "Buy",
      target: "buy",
      priority: 94,
    });
  }

  return items.sort((left, right) => readinessRank(right.state) - readinessRank(left.state) || right.priority - left.priority);
}

function buildEbayReadiness(input: LaunchReadinessInput): LaunchReadinessItem {
  if (input.ebayConnected && input.ebayHasPolicies && input.ebayHasMerchantLocation) {
    return {
      id: "ebay-automation",
      title: "eBay automation",
      detail: "Seller account, policies and location are ready for offer creation.",
      state: "done",
      action: "Listings",
      target: "listings",
      priority: 86,
    };
  }

  if (input.ebayConnected && input.ebayHasPolicies && !input.ebayHasMerchantLocation) {
    return {
      id: "ebay-automation",
      title: "eBay automation",
      detail: "Policies are ready. Add the seller location before creating eBay offers.",
      state: "warn",
      action: "Listings",
      target: "listings",
      priority: 86,
    };
  }

  if (input.ebayConnected && !input.ebayHasPolicies) {
    return {
      id: "ebay-automation",
      title: "eBay automation",
      detail: "Account is connected. Add payment, postage and return policies before creating offers.",
      state: "warn",
      action: "Setup",
      target: "external",
      priority: 86,
    };
  }

  if (input.ebayConfigured) {
    return {
      id: "ebay-automation",
      title: "eBay automation",
      detail: "Connect the seller account before pushing listing offers from the app.",
      state: "warn",
      action: "Setup",
      target: "external",
      priority: 86,
    };
  }

  return {
    id: "ebay-automation",
    title: "eBay automation",
    detail: "Add eBay production credentials when you are ready to automate listings.",
    state: "next",
    action: "Setup",
    target: "external",
    priority: 46,
  };
}

function buildCompReadiness(input: LaunchReadinessInput): LaunchReadinessItem {
  if (input.livePrimaryComps && input.liveCatalogKey) {
    return {
      id: "live-comps",
      title: "Live comps",
      detail: "Price Tracker and card art/catalog are working.",
      state: "done",
      priority: 100,
    };
  }

  return {
    id: "live-comps",
    title: "Live comps",
    detail: input.livePrimaryComps
      ? "Add the catalog key before relying on card images and set matching."
      : "Add the primary comp key before buying from live prices.",
    state: "warn",
    action: "Setup",
    target: "external",
    priority: 100,
  };
}

function buildCrossCheckReadiness(input: LaunchReadinessInput): LaunchReadinessItem {
  if (input.secondaryCrossCheck) {
    return {
      id: "cross-check",
      title: "Second source",
      detail: "Raw/graded comps have a live cross-check.",
      state: "done",
      priority: 90,
    };
  }

  return {
    id: "cross-check",
    title: "Second source",
    detail: "Add PokeTrace to flag noisy raw prices before you trust bigger buys.",
    state: "warn",
    action: "Setup",
    target: "external",
    priority: 90,
  };
}

function buildListingReadiness(input: LaunchReadinessInput): LaunchReadinessItem {
  if (input.activeListings > 0) {
    return {
      id: "listing-pipeline",
      title: "Listing pipeline",
      detail: `${input.activeListings} active listing${input.activeListings === 1 ? "" : "s"}.`,
      state: "done",
      action: "Listings",
      target: "listings",
      priority: 82,
    };
  }

  if (input.draftListings > 0) {
    return {
      id: "listing-pipeline",
      title: "Listing pipeline",
      detail: `${input.draftListings} draft listing${input.draftListings === 1 ? "" : "s"} ready to activate or export.`,
      state: "next",
      action: "List",
      target: "listings",
      priority: 82,
    };
  }

  return {
    id: "listing-pipeline",
    title: "Listing pipeline",
    detail: input.stockCount > 0 ? "Create or activate a listing for stocked cards." : "Your first buy can create a draft listing.",
    state: "next",
    action: input.stockCount > 0 ? "List" : "Buy",
    target: input.stockCount > 0 ? "listings" : "buy",
    priority: 82,
  };
}

function buildSaleReadiness(input: LaunchReadinessInput): LaunchReadinessItem {
  if (input.soldCount > 0) {
    return {
      id: "sale-loop",
      title: "Profit loop",
      detail: `${input.soldCount} sale${input.soldCount === 1 ? "" : "s"} booked.`,
      state: "done",
      action: "Profit",
      target: "profit",
      priority: 76,
    };
  }

  return {
    id: "sale-loop",
    title: "Profit loop",
    detail: input.stockCount > 0 ? "Book the first sale to prove true margin." : "Buy first, then sale profit becomes useful.",
    state: "next",
    action: input.stockCount > 0 ? "Sell" : "Buy",
    target: input.stockCount > 0 ? "stock" : "buy",
    priority: 76,
  };
}

function buildAlertReadiness(input: LaunchReadinessInput): LaunchReadinessItem {
  if (input.alertDelivery) {
    return {
      id: "alerts",
      title: "Alerts",
      detail: "Price-drop and reprice checks can notify outside the app.",
      state: "done",
      priority: 38,
    };
  }

  if (input.activeListings === 0 && input.activeWatches === 0) {
    return {
      id: "alerts",
      title: "Alerts",
      detail: "In-app reprices are enough until listings or buy targets are active.",
      state: "next",
      priority: 18,
    };
  }

  return {
    id: "alerts",
    title: "Alerts",
    detail: "Price drops and reprices stay in-app for now.",
    state: "next",
    priority: 18,
  };
}

function buildWatchReadiness(input: LaunchReadinessInput): LaunchReadinessItem {
  if (input.activeWatches > 0) {
    return {
      id: "buy-targets",
      title: "Buy targets",
      detail: `${input.activeWatches} sourcing target${input.activeWatches === 1 ? "" : "s"} active.`,
      state: "done",
      action: "Targets",
      target: "watches",
      priority: 60,
    };
  }

  return {
    id: "buy-targets",
    title: "Buy targets",
    detail: "Track one chase card below your buy price.",
    state: "next",
    action: "Target",
    target: "watches",
    priority: 60,
  };
}

function buildCostReadiness(input: LaunchReadinessInput): LaunchReadinessItem {
  if (input.operatingExpensePence > 0) {
    return {
      id: "costs",
      title: "Costs",
      detail: "Setup costs are included in net profit.",
      state: "done",
      action: "Costs",
      target: "profit",
      priority: 54,
    };
  }

  return {
    id: "costs",
    title: "Costs",
    detail: "Add supplies, postage, grading, travel, or table fees.",
    state: "next",
    action: "Costs",
    target: "profit",
    priority: 54,
  };
}

function readinessRank(state: LaunchReadinessState): number {
  if (state === "warn") return 3;
  if (state === "next") return 2;
  return 1;
}
