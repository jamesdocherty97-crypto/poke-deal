// Pricing logic — turns a cleaned comp into a suggested list price (GBP pence).
// Valuing and pricing-to-sell are the SAME pipeline: a suggested price is just
// a policy applied to the comp distribution, with a floor to protect margin.

import type { CompResult, RawCondition } from "../domain/types.js";
import { isConfident } from "./cleaning.js";

export type PricingStrategy =
  | "patient" // hold out for the top of the market (75th pct)
  | "market" // priced at the median (default)
  | "quick"; // move it fast (40th pct)

export interface PriceSuggestionInput {
  comp: CompResult | null;
  strategy?: PricingStrategy;
  /** What I paid per unit (GBP pence). Used to enforce a minimum margin. */
  costBasisPence?: number;
  /** Minimum margin over cost basis, as a fraction. Default 0.10 (10%). */
  minMargin?: number;
  /** Raw card condition. Used to avoid pricing LP/MP/HP raw buys from an NM-ish comp. */
  condition?: string | null;
}

export interface PriceSuggestion {
  pricePence: number;
  strategy: PricingStrategy;
  confidence: "high" | "low" | "none";
  /** Set when the floor overrode the market-derived price. */
  flooredToMargin: boolean;
  rationale: string;
}

/** Manual-check evidence stays visible, but cannot enter automatic pricing. */
export function compForAutomaticPricing(comp: CompResult | null, manualCheck: boolean): CompResult | null {
  return manualCheck ? null : comp;
}

export function reviewedCompRequiresManualPricing(input: {
  explicitManualCheck?: boolean;
  sourcesDisagree: boolean;
  grade: string;
  source: string;
  medianPence: number;
}): boolean {
  if (input.explicitManualCheck || input.sourcesDisagree) return true;
  const trustedHighValueRawSource = input.source === "checked-comps" || input.source === "owned-sales";
  return input.grade === "RAW" && input.medianPence >= 10_000 && !trustedHighValueRawSource;
}

const STRATEGY_FACTORS: Record<PricingStrategy, number> = {
  patient: 1.15,
  market: 1.0,
  quick: 0.85,
};

const RAW_CONDITION_FACTORS: Record<string, number> = {
  NM: 1,
  LP: 0.85,
  MP: 0.7,
  HP: 0.55,
  DMG: 0.4,
};

/**
 * Suggest a list price from a comp. Strategy nudges around the median; a cost-basis
 * floor guarantees a minimum margin even if the market is soft. Confidence flows
 * straight from the comp's sample size so the UI can warn on thin data.
 */
export function suggestListPrice(input: PriceSuggestionInput): PriceSuggestion {
  const { comp, strategy = "market", costBasisPence, minMargin = 0.1, condition } = input;

  if (!comp || comp.sampleSize === 0) {
    return {
      pricePence: costBasisPence ? Math.round(costBasisPence * (1 + minMargin)) : 0,
      strategy,
      confidence: "none",
      flooredToMargin: Boolean(costBasisPence),
      rationale:
        "No usable comps. " +
        (costBasisPence
          ? "Priced at cost + minimum margin until comps exist."
          : "Cannot price — needs comps or a cost basis."),
    };
  }

  const conditionFactor = rawConditionPriceFactor(comp.grade, condition);
  const conditionCode = conditionFactor < 1 ? normalizeRawCondition(condition) : null;
  const base = comp.medianPence * STRATEGY_FACTORS[strategy] * conditionFactor;
  let pricePence = Math.round(base);
  let flooredToMargin = false;

  if (costBasisPence != null) {
    const floor = Math.round(costBasisPence * (1 + minMargin));
    if (pricePence < floor) {
      pricePence = floor;
      flooredToMargin = true;
    }
  }

  const confidence = isConfident(comp) ? "high" : "low";
  const trendNote =
    comp.trendPct == null
      ? ""
      : ` Market ${comp.trendPct >= 0 ? "up" : "down"} ${Math.abs(comp.trendPct)}% over the window.`;

  const rationale =
    `${strategy} pricing off median (n=${comp.sampleSize}, ${comp.windowDays}d).` +
    (conditionCode ? ` Raw ${conditionCode} adjustment applied.` : "") +
    (flooredToMargin ? " Raised to protect minimum margin." : "") +
    trendNote +
    (confidence === "low" ? " ⚠ Thin sample — treat as indicative." : "");

  return { pricePence, strategy, confidence, flooredToMargin, rationale };
}

export function conditionAdjustedPricePence(
  pricePence: number,
  grade: string | null | undefined,
  condition: string | null | undefined,
): number {
  return Math.round(Math.max(0, pricePence) * rawConditionPriceFactor(grade, condition));
}

export function rawConditionPriceFactor(
  grade: string | null | undefined,
  condition: string | null | undefined,
): number {
  if (grade !== "RAW") return 1;
  const normalized = normalizeRawCondition(condition);
  return normalized ? RAW_CONDITION_FACTORS[normalized] ?? 1 : 1;
}

export function normalizeRawCondition(condition: string | null | undefined): RawCondition | null {
  const normalized = condition?.trim().toUpperCase();
  if (!normalized) return null;
  if (/\b(DMG|DAMAGED|DAMAGE)\b/.test(normalized)) return "DMG";
  if (/\b(HP|HEAVY|HEAVILY\s+PLAYED)\b/.test(normalized)) return "HP";
  if (/\b(MP|MODERATE|MODERATELY\s+PLAYED)\b/.test(normalized)) return "MP";
  if (/\b(LP|LIGHT|LIGHTLY\s+PLAYED)\b/.test(normalized)) return "LP";
  if (/\b(NM|NEAR\s+MINT|MINT)\b/.test(normalized)) return "NM";
  return null;
}

/** Realized profit on a sale (all GBP pence). */
export function realizedProfit(args: {
  salePrice: number;
  fees?: number;
  postage?: number;
  costBasis: number;
}): number {
  const { salePrice, fees = 0, postage = 0, costBasis } = args;
  return salePrice - fees - postage - costBasis;
}
