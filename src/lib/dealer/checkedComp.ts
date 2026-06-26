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

export function parseCheckedCompPriceText(text: string | undefined): number | null {
  const normalized = text?.trim().replace(/\s+/g, " ");
  if (!normalized) return null;

  const currencyMatch =
    normalized.match(/(?:£|GBP\s*)\s*([0-9][0-9,]*(?:[.][0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2}))/i) ??
    normalized.match(/([0-9][0-9,]*(?:[.][0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2}))\s*(?:GBP|pounds?)/i);
  if (currencyMatch?.[1]) return moneyTextToPence(currencyMatch[1]);

  const plainMatch = normalized.match(/^([0-9][0-9,]*(?:[.][0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2}))$/);
  return plainMatch?.[1] ? moneyTextToPence(plainMatch[1]) : null;
}

function positiveInt(value: number | undefined, fallback: number): number {
  const rounded = Math.round(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : fallback;
}

function moneyTextToPence(text: string): number | null {
  const compact = text.trim();
  const decimal =
    compact.includes(".")
      ? compact.replace(/,/g, "")
      : compact.includes(",") && /,\d{1,2}$/.test(compact)
        ? compact.replace(",", ".")
        : compact.replace(/,/g, "");
  const amount = Number(decimal);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}
