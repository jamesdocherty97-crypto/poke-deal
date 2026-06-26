export type OperatingSnapshotTone = "good" | "warn" | "info";

export interface OperatingSnapshotInput {
  activeCostPence: number;
  cashInPence: number;
  cashOutPence: number;
  cashNetPence: number;
  cashRecoveryPct: number;
  sellThroughPct: number;
  draftListings: number;
  activeListings: number;
}

export interface OperatingSnapshotRow {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: OperatingSnapshotTone;
}

export function buildOperatingSnapshot(input: OperatingSnapshotInput): OperatingSnapshotRow[] {
  const listingTotal = input.draftListings + input.activeListings;

  return [
    {
      id: "stock-cost",
      label: "Stock at cost",
      value: formatPounds(input.activeCostPence),
      detail: "cash tied up in unsold cards",
      tone: input.activeCostPence > 0 ? "info" : "warn",
    },
    {
      id: "cash-net",
      label: "Cash net",
      value: formatSignedPounds(input.cashNetPence),
      detail: `${formatPounds(input.cashInPence)} in / ${formatPounds(input.cashOutPence)} out`,
      tone: input.cashNetPence >= 0 ? "good" : input.cashInPence > 0 ? "warn" : "info",
    },
    {
      id: "listing-pipeline",
      label: "Listing pipe",
      value: `${input.activeListings} live / ${input.draftListings} draft`,
      detail: listingTotal > 0 ? "selling surface loaded" : "nothing listed yet",
      tone: input.activeListings > 0 ? "good" : input.draftListings > 0 ? "warn" : "info",
    },
    {
      id: "sell-through",
      label: "Sell-through",
      value: `${formatPct(input.sellThroughPct)}%`,
      detail: `${formatPct(input.cashRecoveryPct)}% cash recovery`,
      tone: input.sellThroughPct > 0 ? "good" : "info",
    },
  ];
}

function formatPounds(pence: number): string {
  return `£${(Math.round(pence) / 100).toFixed(2)}`;
}

function formatSignedPounds(pence: number): string {
  const rounded = Math.round(pence);
  if (rounded === 0) return "£0.00";
  return `${rounded > 0 ? "+" : "-"}${formatPounds(Math.abs(rounded))}`;
}

function formatPct(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
