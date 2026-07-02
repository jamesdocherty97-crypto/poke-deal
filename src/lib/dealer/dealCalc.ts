import type { Grade } from "../domain/types.js";

export type DealConfidence = "high" | "medium" | "low";
export type DealRoute = "flip" | "grade" | "no-quote";

export interface DealPostageTier {
  upToPence: number | null;
  postagePence: number;
}

export interface DealCalcSettings {
  fees: {
    ebayFvfPct: number;
    ebayFixedPence: number;
    promotedPct: number;
    promotedEnabled: boolean;
    postageTiers: DealPostageTier[];
    materialsPence: number;
  };
  marginTargetPct: number;
  confidenceHaircut: Record<DealConfidence, number>;
  liquidityHaircut: {
    nAtLeast100: number;
    n30To99: number;
    nUnder30: number;
  };
  tradePremiumPct: number;
  grading: {
    costPence: number;
    postageToGraderPence: number;
    gradeProbabilities: Record<string, number>;
  };
}

export interface DealCalcGradedComp {
  grade: Grade | string;
  headlinePence: number;
  confidence: DealConfidence;
}

export interface DealCalcCompInput {
  headlinePence: number | null;
  confidence: DealConfidence;
  manualCheck: boolean;
  gradeBucket: Grade | string;
  sampleSizeOfChosen: number;
  reasons?: string[];
  gradedComps?: DealCalcGradedComp[];
}

export interface DealCalcOptions {
  grading?: {
    gradeProbabilities?: Record<string, number>;
    costPence?: number;
    postageToGraderPence?: number;
  };
}

export type DealCalcSettingsInput = Partial<Omit<DealCalcSettings, "fees" | "confidenceHaircut" | "liquidityHaircut" | "grading">> & {
  fees?: Partial<DealCalcSettings["fees"]>;
  confidenceHaircut?: Partial<DealCalcSettings["confidenceHaircut"]>;
  liquidityHaircut?: Partial<DealCalcSettings["liquidityHaircut"]>;
  grading?: Partial<Omit<DealCalcSettings["grading"], "gradeProbabilities">> & {
    gradeProbabilities?: Partial<Record<string, number>>;
  };
};

export interface DealCalcGradeRoute {
  evPence: number;
  breakdown: Array<{
    grade: string;
    probability: number;
    netProceedsPence: number;
    contributionPence: number;
    confidence: DealConfidence;
  }>;
}

export interface DealCalcResult {
  netProceedsPence: number | null;
  maxCashOfferPence: number | null;
  maxTradeOfferPence: number | null;
  expectedProfitPence: number | null;
  route: DealRoute;
  gradeRoute?: DealCalcGradeRoute;
  reasons: string[];
}

// UK eBay card-dealer defaults as of mid-2026. Keep these editable in UI and
// review quarterly because platform fees and postage costs move over time.
export const DEFAULT_DEAL_CALC_SETTINGS: DealCalcSettings = {
  fees: {
    ebayFvfPct: 12.8,
    ebayFixedPence: 30,
    promotedPct: 2,
    promotedEnabled: true,
    postageTiers: [
      { upToPence: 1999, postagePence: 155 },
      { upToPence: 10000, postagePence: 270 },
      { upToPence: null, postagePence: 550 },
    ],
    materialsPence: 30,
  },
  marginTargetPct: 20,
  confidenceHaircut: { high: 1, medium: 0.85, low: 0.7 },
  liquidityHaircut: { nAtLeast100: 1, n30To99: 0.95, nUnder30: 0.85 },
  tradePremiumPct: 10,
  grading: {
    costPence: 2500,
    postageToGraderPence: 0,
    gradeProbabilities: { PSA_10: 0.3, PSA_9: 0.5, PSA_8: 0.2 },
  },
};

export function dealCalc(
  comp: DealCalcCompInput,
  settings: DealCalcSettings = DEFAULT_DEAL_CALC_SETTINGS,
  options: DealCalcOptions = {},
): DealCalcResult {
  const reasons = [...(comp.reasons ?? [])];

  if (comp.headlinePence == null || comp.headlinePence <= 0) {
    return {
      netProceedsPence: null,
      maxCashOfferPence: null,
      maxTradeOfferPence: null,
      expectedProfitPence: null,
      route: "no-quote",
      reasons: withReason(reasons, "no headline comp"),
    };
  }

  const netProceedsPence = netProceedsAtSalePrice(comp.headlinePence, settings);
  if (comp.manualCheck) {
    return {
      netProceedsPence,
      maxCashOfferPence: null,
      maxTradeOfferPence: null,
      expectedProfitPence: null,
      route: "no-quote",
      gradeRoute: buildGradeRoute(comp, settings, options),
      reasons: withReason(reasons, "manual check required"),
    };
  }
  if (comp.confidence === "low" && comp.headlinePence >= 10000) {
    return {
      netProceedsPence,
      maxCashOfferPence: null,
      maxTradeOfferPence: null,
      expectedProfitPence: null,
      route: "no-quote",
      gradeRoute: buildGradeRoute(comp, settings, options),
      reasons: withReason(withConfidenceReasons(reasons, comp), "low confidence above £100"),
    };
  }

  const confidenceHaircut = settings.confidenceHaircut[comp.confidence];
  const liquidityHaircut = liquidityHaircutForSample(comp.sampleSizeOfChosen, settings);
  const adjustedPence = Math.round(netProceedsPence * confidenceHaircut * liquidityHaircut);
  const rawCashOffer = adjustedPence / (1 + settings.marginTargetPct / 100);
  const maxCashOfferPence = roundOfferDown(rawCashOffer);
  const maxTradeOfferPence = roundOfferDown(maxCashOfferPence * (1 + settings.tradePremiumPct / 100));
  const expectedProfitPence = adjustedPence - maxCashOfferPence;
  const gradeRoute = buildGradeRoute(comp, settings, options);
  const route =
    gradeRoute && gradeRoute.evPence > adjustedPence * 1.25
      ? "grade"
      : "flip";

  return {
    netProceedsPence,
    maxCashOfferPence,
    maxTradeOfferPence,
    expectedProfitPence,
    route,
    gradeRoute,
    reasons: withLiquidityReasons(withConfidenceReasons(reasons, comp), comp.sampleSizeOfChosen),
  };
}

export function netProceedsAtSalePrice(salePricePence: number, settings: DealCalcSettings = DEFAULT_DEAL_CALC_SETTINGS): number {
  const pct = settings.fees.ebayFvfPct + (settings.fees.promotedEnabled ? settings.fees.promotedPct : 0);
  const variableAfterFees = Math.round(salePricePence * (1 - pct / 100));
  return variableAfterFees - settings.fees.ebayFixedPence - postageForSalePrice(salePricePence, settings) - settings.fees.materialsPence;
}

export function postageForSalePrice(salePricePence: number, settings: DealCalcSettings = DEFAULT_DEAL_CALC_SETTINGS): number {
  const tiers = [...settings.fees.postageTiers].sort((a, b) => {
    if (a.upToPence == null) return 1;
    if (b.upToPence == null) return -1;
    return a.upToPence - b.upToPence;
  });
  return tiers.find((tier) => tier.upToPence == null || salePricePence <= tier.upToPence)?.postagePence ?? 0;
}

export function roundOfferDown(valuePence: number): number {
  const positive = Math.max(0, Math.floor(valuePence));
  const step = positive < 2000 ? 50 : positive < 10000 ? 100 : 500;
  return Math.floor(positive / step) * step;
}

export function normalizeDealCalcSettings(input: DealCalcSettingsInput): DealCalcSettings {
  return {
    ...DEFAULT_DEAL_CALC_SETTINGS,
    ...input,
    fees: {
      ...DEFAULT_DEAL_CALC_SETTINGS.fees,
      ...input.fees,
      postageTiers: input.fees?.postageTiers?.length
        ? input.fees.postageTiers
        : DEFAULT_DEAL_CALC_SETTINGS.fees.postageTiers,
    },
    confidenceHaircut: {
      ...DEFAULT_DEAL_CALC_SETTINGS.confidenceHaircut,
      ...input.confidenceHaircut,
    },
    liquidityHaircut: {
      ...DEFAULT_DEAL_CALC_SETTINGS.liquidityHaircut,
      ...input.liquidityHaircut,
    },
    grading: {
      ...DEFAULT_DEAL_CALC_SETTINGS.grading,
      ...input.grading,
      gradeProbabilities: mergeGradeProbabilities(input.grading?.gradeProbabilities),
    },
  };
}

function mergeGradeProbabilities(input: Partial<Record<string, number>> | undefined): Record<string, number> {
  const merged: Record<string, number> = { ...DEFAULT_DEAL_CALC_SETTINGS.grading.gradeProbabilities };
  for (const [grade, probability] of Object.entries(input ?? {})) {
    if (probability == null || !Number.isFinite(probability)) continue;
    merged[grade] = probability;
  }
  return merged;
}

function buildGradeRoute(
  comp: DealCalcCompInput,
  settings: DealCalcSettings,
  options: DealCalcOptions,
): DealCalcGradeRoute | undefined {
  if (comp.gradeBucket !== "RAW" || !comp.gradedComps?.length) return undefined;
  const gradeProbabilities = options.grading?.gradeProbabilities ?? settings.grading.gradeProbabilities;
  const gradingCostPence = options.grading?.costPence ?? settings.grading.costPence;
  const postageToGraderPence = options.grading?.postageToGraderPence ?? settings.grading.postageToGraderPence;
  const breakdown = comp.gradedComps
    .filter((graded) => graded.headlinePence > 0 && graded.confidence !== "low")
    .map((graded) => {
      const grade = String(graded.grade);
      const probability = gradeProbabilities[grade] ?? gradeProbabilities[grade.replace(/ /g, "_")] ?? 0;
      const netProceedsPence = netProceedsAtSalePrice(graded.headlinePence, settings);
      return {
        grade,
        probability,
        netProceedsPence,
        contributionPence: Math.round(probability * netProceedsPence),
        confidence: graded.confidence,
      };
    })
    .filter((row) => row.probability > 0);
  if (breakdown.length === 0) return undefined;
  const grossEvPence = breakdown.reduce((sum, row) => sum + row.contributionPence, 0);
  return {
    evPence: grossEvPence - gradingCostPence - postageToGraderPence,
    breakdown,
  };
}

function liquidityHaircutForSample(sampleSize: number, settings: DealCalcSettings): number {
  if (sampleSize >= 100) return settings.liquidityHaircut.nAtLeast100;
  if (sampleSize >= 30) return settings.liquidityHaircut.n30To99;
  return settings.liquidityHaircut.nUnder30;
}

function withConfidenceReasons(reasons: string[], comp: DealCalcCompInput): string[] {
  if (comp.confidence === "low") return withReason(reasons, "low confidence");
  if (comp.confidence === "medium") return withReason(reasons, "medium confidence haircut");
  return reasons;
}

function withLiquidityReasons(reasons: string[], sampleSize: number): string[] {
  if (sampleSize < 30) return withReason(reasons, "thin liquidity haircut");
  if (sampleSize < 100) return withReason(reasons, "medium liquidity haircut");
  return reasons;
}

function withReason(reasons: string[], reason: string): string[] {
  return reasons.includes(reason) ? reasons : [...reasons, reason];
}
