import type { CompResult } from "../domain/types.js";
import { suggestListPrice, type PricingStrategy } from "../comps/pricing.js";
import { formatGbp } from "../comps/currency.js";

export interface RepriceInput {
  itemId: string;
  cardName: string;
  grade: string;
  currentPricePence: number;
  costBasisPence: number;
  comp: CompResult;
  condition?: string | null;
  strategy?: PricingStrategy;
  thresholdPct?: number;
  sourcesDisagree?: boolean;
}

export interface RepriceRecommendation {
  itemId: string;
  cardName: string;
  grade: string;
  currentPricePence: number;
  suggestedPricePence: number;
  movePct: number;
  confidence: "high" | "low" | "none";
  reason: string;
}

export function recommendReprice(input: RepriceInput): RepriceRecommendation | null {
  const thresholdPct = input.thresholdPct ?? 10;
  if (input.currentPricePence <= 0 || input.comp.sampleSize === 0) return null;

  const suggestion = suggestListPrice({
    comp: input.comp,
    strategy: input.strategy ?? "market",
    costBasisPence: input.costBasisPence,
    condition: input.condition,
  });
  const movePct = roundOne(
    ((suggestion.pricePence - input.currentPricePence) / input.currentPricePence) * 100,
  );

  if (Math.abs(movePct) < thresholdPct && !input.sourcesDisagree) return null;

  const direction = movePct >= 0 ? "raise" : "drop";
  const disagreement = input.sourcesDisagree ? " Sources disagree; verify before changing." : "";

  return {
    itemId: input.itemId,
    cardName: input.cardName,
    grade: input.grade,
    currentPricePence: input.currentPricePence,
    suggestedPricePence: suggestion.pricePence,
    movePct,
    confidence: suggestion.confidence,
    reason: `${direction} from ${formatGbp(input.currentPricePence)} to ${formatGbp(suggestion.pricePence)} (${movePct}%). ${suggestion.rationale}${disagreement}`,
  };
}

export function formatRepriceDigest(recommendations: RepriceRecommendation[]): string {
  if (recommendations.length === 0) return "No repricing actions right now.";
  return recommendations
    .map(
      (rec) =>
        `${rec.cardName} ${rec.grade.replace(/_/g, " ")}: ${formatGbp(rec.currentPricePence)} -> ${formatGbp(rec.suggestedPricePence)} (${rec.movePct}%, ${rec.confidence})`,
    )
    .join("\n");
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
