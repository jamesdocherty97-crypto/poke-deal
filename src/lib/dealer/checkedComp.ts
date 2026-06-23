import type { CardRef, CompResult, Grade } from "../domain/types.js";

export type CheckedCompSource = "EBAY_SOLD" | "CARDMARKET" | "TCGPLAYER" | "OTHER";

export interface CheckedCompInput {
  card: CardRef;
  grade: Grade;
  pricePence: number;
  sampleSize?: number;
  windowDays?: number;
  source?: CheckedCompSource;
  note?: string;
  asOf?: string;
}

export function buildCheckedComp(input: CheckedCompInput): CompResult | null {
  const pricePence = Math.round(input.pricePence);
  if (!Number.isFinite(pricePence) || pricePence <= 0) return null;

  const source = input.source ?? "EBAY_SOLD";
  const sampleSize = positiveInt(input.sampleSize, 1);
  const windowDays = positiveInt(input.windowDays, 30);
  const note = input.note?.trim();

  return {
    source: "manual-check",
    card: input.card,
    grade: input.grade,
    currency: "GBP",
    medianPence: pricePence,
    meanPence: pricePence,
    lowPence: pricePence,
    highPence: pricePence,
    sampleSize,
    windowDays,
    trendPct: null,
    outliersRemoved: 0,
    asOf: input.asOf ?? new Date().toISOString(),
    raw: {
      kind: "checked-comp",
      source,
      sourceLabel: checkedCompSourceLabel(source),
      ...(note ? { note } : {}),
    },
  };
}

export function checkedCompSourceLabel(source: CheckedCompSource | string | undefined): string {
  if (source === "EBAY_SOLD") return "eBay sold";
  if (source === "CARDMARKET") return "Cardmarket";
  if (source === "TCGPLAYER") return "TCGPlayer";
  return "Checked comp";
}

function positiveInt(value: number | undefined, fallback: number): number {
  const rounded = Math.round(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : fallback;
}
