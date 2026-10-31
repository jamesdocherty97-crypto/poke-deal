/**
 * Decides what Today can show when stock, listings, or sales fail to load.
 * A full block is only when both the stock book and the sales ledger are missing.
 * A partial load keeps the mission the loaded side can support, and names the miss.
 */

import type { OperatingSnapshotRow } from "./operatingSnapshot.js";

export const TODAY_BLOCKED_MESSAGE = "Couldn't load your stock and sales. Check signal and try again.";

export type TodaySourceAvailability = {
  /** A payload is in memory: this attempt, or an earlier successful load. */
  known: boolean;
  /** The latest attempt failed. */
  failed: boolean;
};

export type TodayRecoveryInput = {
  inventory: TodaySourceAvailability;
  listings: TodaySourceAvailability;
  dashboard: TodaySourceAvailability;
  /** Inventory rows in memory. Ignored unless inventory is known. */
  stockRowCount: number;
  /** Dashboard sold count. Ignored unless the sales ledger is known. */
  soldCount: number;
};

export type TodayRecoveryMission = {
  title: string;
  detail: string;
  action: string;
  target: "retry";
  kind: "recovery";
};

export type TodayRecovery = {
  mode: "blocked" | "partial" | "ready";
  blockedMessage: string | null;
  banner: string | null;
  trustStock: boolean;
  trustListings: boolean;
  trustSales: boolean;
  /** Null when the first-sale quest can move. */
  questNote: string | null;
  /** Replaces the empty-business mission. Null when that mission is allowed. */
  emptyBusinessMission: TodayRecoveryMission | null;
};

const SOURCE_ORDER = ["inventory", "listings", "dashboard"] as const;

const SOURCE_LABEL: Record<(typeof SOURCE_ORDER)[number], string> = {
  inventory: "stock",
  listings: "listings",
  dashboard: "sales",
};

const SALES_DEPENDENT_ACTIONS = new Set(["first-sale", "active-sales", "log-first-cost", "aged-stock"]);
const STOCK_DEPENDENT_ACTIONS = new Set(["opening-stock", "first-buy", "unlisted-stock", "comp-next-buy"]);
const LISTING_DEPENDENT_ACTIONS = new Set(["draft-listings", "reprice", "active-sales"]);

export function todayColdStartRecovery(input: TodayRecoveryInput): TodayRecovery {
  const trustStock = input.inventory.known;
  const trustListings = input.listings.known;
  const trustSales = input.dashboard.known;
  const blocked = !trustStock && !trustSales;
  const failed = failedSources(input);
  const partial = !blocked && failed.length > 0;
  const stockRows = trustStock ? input.stockRowCount : 0;
  const soldCount = trustSales ? input.soldCount : 0;

  return {
    mode: blocked ? "blocked" : partial ? "partial" : "ready",
    blockedMessage: blocked ? TODAY_BLOCKED_MESSAGE : null,
    banner: partial ? bannerCopy(input, failed, { trustStock, trustSales, stockRows, soldCount }) : null,
    trustStock,
    trustListings,
    trustSales,
    questNote: questNote(trustStock, trustSales, blocked),
    emptyBusinessMission: emptyBusinessMission({ trustStock, trustSales, stockRows, soldCount }),
  };
}

export function todayMissionForRecovery<T extends { kind: string }>(
  mission: T,
  recovery: TodayRecovery,
): T | TodayRecoveryMission {
  if (mission.kind !== "import" || !recovery.emptyBusinessMission) return mission;
  return recovery.emptyBusinessMission;
}

export function todayActionsForRecovery<T extends { id: string }>(
  actions: readonly T[],
  recovery: TodayRecovery,
): T[] {
  if (recovery.mode === "blocked") return [];
  return actions.filter((action) => {
    if (!recovery.trustSales && SALES_DEPENDENT_ACTIONS.has(action.id)) return false;
    if (!recovery.trustStock && STOCK_DEPENDENT_ACTIONS.has(action.id)) return false;
    if (!recovery.trustListings && LISTING_DEPENDENT_ACTIONS.has(action.id)) return false;
    return true;
  });
}

export function embeddedListingCounts(items: readonly { listings: readonly { state: string }[] }[]): { drafts: number; live: number } {
  let drafts = 0;
  let live = 0;
  for (const item of items) {
    for (const listing of item.listings) {
      if (listing.state === "DRAFT") drafts += 1;
      if (listing.state === "ACTIVE") live += 1;
    }
  }
  return { drafts, live };
}

export function presentOperatingSnapshot(
  rows: readonly OperatingSnapshotRow[],
  recovery: TodayRecovery,
  embedded: { drafts: number; live: number } | null,
): OperatingSnapshotRow[] {
  return rows.map((row) => {
    if (!recovery.trustSales && (row.id === "stock-cost" || row.id === "cash-net" || row.id === "sell-through")) {
      return { ...row, value: "Not loaded", detail: "Sales did not load.", tone: "warn" };
    }
    if (row.id === "listing-pipeline" && !recovery.trustListings) {
      if (recovery.trustStock && embedded) {
        return {
          ...row,
          value: `${embedded.live} live / ${embedded.drafts} draft`,
          detail: "Counted from the stock book. The listing desk did not load.",
          tone: embedded.live > 0 ? "good" : embedded.drafts > 0 ? "warn" : "info",
        };
      }
      return { ...row, value: "Not loaded", detail: "The listing desk did not load.", tone: "warn" };
    }
    return row;
  });
}

function failedSources(input: TodayRecoveryInput): Array<(typeof SOURCE_ORDER)[number]> {
  return SOURCE_ORDER.filter((source) => input[source].failed);
}

function bannerCopy(
  input: TodayRecoveryInput,
  failed: Array<(typeof SOURCE_ORDER)[number]>,
  trusted: { trustStock: boolean; trustSales: boolean; stockRows: number; soldCount: number },
): string {
  const verb = failed.every((source) => input[source].known) ? "refresh" : "load";
  const named = joinNames(failed.map((source) => SOURCE_LABEL[source]));
  return `Couldn't ${verb} ${named}. ${keptSentence(verb, trusted)}`;
}

function keptSentence(
  verb: "load" | "refresh",
  trusted: { trustStock: boolean; trustSales: boolean; stockRows: number; soldCount: number },
): string {
  if (!trusted.trustStock && trusted.trustSales) {
    return trusted.soldCount > 0
      ? "Sales already loaded are still shown."
      : "No sales are on the loaded ledger, so this is not a new business.";
  }
  if (trusted.trustStock && !trusted.trustSales) {
    return trusted.stockRows > 0
      ? "Stock already loaded stays on screen."
      : "Stock on this device is empty, so this is not a new business.";
  }
  return verb === "refresh"
    ? "The last loaded book is still shown."
    : "Your stock and sales are still shown.";
}

function questNote(trustStock: boolean, trustSales: boolean, blocked: boolean): string | null {
  if (blocked || (trustStock && trustSales)) return null;
  if (!trustStock) return "Stock has to load before this quest can move.";
  return "Sales have to load before this quest can move.";
}

function emptyBusinessMission(
  trusted: { trustStock: boolean; trustSales: boolean; stockRows: number; soldCount: number },
): TodayRecoveryMission | null {
  if (trusted.trustStock && trusted.trustSales) return null;
  if (!trusted.trustStock && !trusted.trustSales) return null;
  if (!trusted.trustStock) {
    if (trusted.soldCount > 0) return null;
    return {
      title: "Stock didn't load",
      detail: "No sales are on the loaded ledger. Stock did not load, so this is not a new business.",
      action: "Retry",
      target: "retry",
      kind: "recovery",
    };
  }
  return {
    title: "Sales didn't load",
    detail: trusted.stockRows > 0
      ? "Cards are already on this device. The sales ledger did not load, so this is not a new business."
      : "The stock book on this device is empty. Sales did not load, so this is not a new business.",
    action: "Retry",
    target: "retry",
    kind: "recovery",
  };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "today";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
