import { reconcileComps, type ReconCandidate, type ReconQuery, type ReconResult } from "./reconciler.js";
import { dealCalc, netProceedsAtSalePrice, type DealCalcResult } from "../dealer/dealCalc.js";

export type PricingBrainAttackVerdict = "SURVIVES" | "DEGRADED" | "FAILS";

export interface PricingBrainAttackOutput {
  id: string;
  name: string;
  setup: string;
  expectedHonestBehaviour: string;
  verdict: PricingBrainAttackVerdict;
  moneyAtRiskPence: number;
  reconciler?: ReconResult;
  dealCalc?: DealCalcResult;
  extra?: Record<string, unknown>;
}

const baseQuery: ReconQuery = {
  setId: "swsh7",
  cardNumber: "94/203",
  language: "EN",
  gradeBucket: "RAW",
  ambiguous: false,
  isVintage: false,
};

function candidate(overrides: Partial<ReconCandidate>): ReconCandidate {
  return {
    source: "poketrace",
    valuePence: 10000,
    n: 50,
    ageDays: 7,
    region: "US",
    matchedSetId: baseQuery.setId,
    matchedCardNumber: baseQuery.cardNumber,
    matchedLanguage: "EN",
    ...overrides,
  };
}

function quoteFrom(result: ReconResult, sampleSizeOfChosen: number): DealCalcResult {
  return dealCalc({
    headlinePence: result.headlinePence,
    confidence: result.confidence,
    manualCheck: result.manualCheck,
    gradeBucket: baseQuery.gradeBucket,
    sampleSizeOfChosen,
    reasons: result.reasons,
  });
}

export function runPricingBrainAttackSuite(): PricingBrainAttackOutput[] {
  const shill = reconcileComps(baseQuery, [
    candidate({
      source: "pt-median",
      valuePence: 50000,
      n: 5,
      raw: { min: 10000, max: 50000, median: 50000, count: 5 },
    }),
    candidate({ source: "poketrace", valuePence: 10000, n: 80, region: "US" }),
  ]);

  const reprintCrash = reconcileComps(baseQuery, [
    candidate({ source: "pt-smart", valuePence: 20000, n: 100, ageDays: 60, raw: { min: 18000, max: 22000, median: 20000 } }),
    candidate({ source: "tcg-market", valuePence: 20000, n: 1, ageDays: 70, region: "EU", fields: { avg30: 20000, trendPrice: 20000 } }),
    candidate({ source: "poketrace", valuePence: 20000, n: 70, ageDays: 70, region: "US" }),
  ]);

  const checkedTrap = reconcileComps(baseQuery, [
    candidate({ source: "checked-comps", valuePence: 20000, n: 2, ageDays: 80, region: "UK", traceableUkSales: 2, conditionMatched: true }),
    candidate({ source: "poketrace", valuePence: 12000, n: 2, ageDays: 5, region: "US" }),
  ]);

  const gradeBleed = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10" }, [
    candidate({
      source: "pt-median",
      valuePence: 6000,
      n: 40,
      adjacentLowerGradeMedianPence: 5800,
      raw: { min: 5500, max: 6500, median: 6000, count: 40 },
    }),
  ]);

  const staleUsdPerGbp = 1.27;
  const shockedUsdPerGbp = staleUsdPerGbp * 1.08;
  const usdSale = 1270;
  const staleFxPence = Math.round((usdSale / staleUsdPerGbp) * 100);
  const shockedFxPence = Math.round((usdSale / shockedUsdPerGbp) * 100);
  const currencyShock = reconcileComps(baseQuery, [
    candidate({
      source: "poketrace",
      valuePence: staleFxPence,
      n: 500,
      ageDays: 2,
      region: "US",
      convertedFromNonGbp: true,
      fxAgeDays: 6,
    }),
  ]);

  const boundary1999 = dealCalc({
    headlinePence: 1999,
    confidence: "high",
    manualCheck: false,
    gradeBucket: "RAW",
    sampleSizeOfChosen: 500,
  });
  const boundary2000 = dealCalc({
    headlinePence: 2000,
    confidence: "high",
    manualCheck: false,
    gradeBucket: "RAW",
    sampleSizeOfChosen: 500,
  });

  const ownedFiresale = reconcileComps(baseQuery, [
    candidate({ source: "owned-sales", valuePence: 7000, n: 3, ageDays: 10, region: "UK" }),
    candidate({ source: "poketrace", valuePence: 10000, n: 500, ageDays: 5, region: "UK" }),
  ]);

  const dominantBadSource = reconcileComps(baseQuery, [
    candidate({ source: "poketrace", valuePence: 2000, n: 5000, ageDays: 3, region: "US" }),
    candidate({ source: "checked-comps", valuePence: 10000, n: 50, ageDays: 2, region: "UK", traceableUkSales: 50, conditionMatched: true }),
  ]);

  const ukSmallVsHugeUs = reconcileComps(baseQuery, [
    candidate({ source: "checked-comps", valuePence: 10000, n: 8, ageDays: 2, region: "UK", traceableUkSales: 8, conditionMatched: true }),
    candidate({ source: "poketrace", valuePence: 14000, n: 5000, ageDays: 2, region: "US" }),
  ]);

  const vintageRawSingleProvider = reconcileComps({ ...baseQuery, setId: "base1", cardNumber: "4/102", isVintage: true }, [
    candidate({ source: "pt-median", valuePence: 90000, n: 7, ageDays: 12, region: "US", matchedSetId: "base1", matchedCardNumber: "4/102" }),
  ]);

  return [
    {
      id: "A1",
      name: "Shill-bid poisoning",
      setup: "Thin pt-median bucket has 3/5 inflated sales implied by a GBP 500 headline; PokeTrace has a broader GBP 100 baseline.",
      expectedHonestBehaviour: "Reject or down-rank the thin inflated bucket and force manual checking.",
      verdict: shill.chosenSource === "poketrace" && shill.manualCheck ? "SURVIVES" : "FAILS",
      moneyAtRiskPence: 40000,
      reconciler: shill,
      dealCalc: quoteFrom(shill, 80),
    },
    {
      id: "A2",
      name: "Reprint crash",
      setup: "All available sources are 60-70 days old and still show GBP 200 after a hypothetical overnight true-value crash to GBP 100.",
      expectedHonestBehaviour: "Avoid treating stale agreement as fresh certainty, or visibly warn that no post-crash source exists.",
      verdict: reprintCrash.manualCheck && reprintCrash.reasons.includes("stale-consensus") ? "SURVIVES" : "FAILS",
      moneyAtRiskPence: 10000,
      reconciler: reprintCrash,
      dealCalc: quoteFrom(reprintCrash, 100),
      extra: { hypotheticalTrueValuePence: 10000 },
    },
    {
      id: "A3",
      name: "Checked-comp staleness trap",
      setup: "Two dealer-checked comps from 80 days ago sit at GBP 200; a thin fresh US baseline says GBP 120.",
      expectedHonestBehaviour: "Show the checked comps, but avoid an automatic buy quote until the dealer verifies current solds.",
      verdict: checkedTrap.manualCheck ? "DEGRADED" : "FAILS",
      moneyAtRiskPence: 8000,
      reconciler: checkedTrap,
      dealCalc: quoteFrom(checkedTrap, 2),
    },
    {
      id: "A4",
      name: "Grade bleed",
      setup: "A PSA 10 query receives a clean-looking provider aggregate that is actually PSA 9 data.",
      expectedHonestBehaviour: "Detect grade leakage or force manual verification for single-provider slab data.",
      verdict: gradeBleed.manualCheck && gradeBleed.reasons.includes("grade-bleed-suspect") ? "SURVIVES" : "FAILS",
      moneyAtRiskPence: 4000,
      reconciler: gradeBleed,
      dealCalc: quoteFrom(gradeBleed, 40),
    },
    {
      id: "A5",
      name: "Currency shock",
      setup: "GBP/USD moves 8 percent while a USD source is converted through a six-day-old FX rate.",
      expectedHonestBehaviour: "Quantify the stale-FX error on high-value cards and warn if stale FX is material.",
      verdict: currencyShock.manualCheck && currencyShock.reasons.includes("fx-aged") ? "SURVIVES" : "FAILS",
      moneyAtRiskPence: Math.abs(staleFxPence - shockedFxPence),
      reconciler: currencyShock,
      dealCalc: quoteFrom(currencyShock, 500),
      extra: {
        usdSale,
        staleUsdPerGbp,
        shockedUsdPerGbp,
        staleFxPence,
        shockedFxPence,
        errorPence: staleFxPence - shockedFxPence,
      },
    },
    {
      id: "A6",
      name: "Deal-calc margin illusion",
      setup: "Compare sale prices either side of the GBP 19.99 to GBP 20.00 postage tier jump.",
      expectedHonestBehaviour: "Quote should step down when the postage tier jumps rather than imply smooth profit.",
      verdict: boundary2000.maxCashOfferPence != null && boundary1999.maxCashOfferPence != null && boundary2000.maxCashOfferPence <= boundary1999.maxCashOfferPence ? "SURVIVES" : "FAILS",
      moneyAtRiskPence: Math.abs(netProceedsAtSalePrice(1999) - netProceedsAtSalePrice(2000)),
      dealCalc: boundary2000,
      extra: { below: boundary1999, above: boundary2000 },
    },
    {
      id: "A7",
      name: "Owned-sales self-poisoning",
      setup: "Dealer's three recent owned sales are a firesale at GBP 70 while current market is GBP 100.",
      expectedHonestBehaviour: "Owned sales should inform, but not silently lowball future stock offers without a disagreement warning.",
      verdict: ownedFiresale.chosenSource === "owned-sales" && !ownedFiresale.manualCheck ? "DEGRADED" : "SURVIVES",
      moneyAtRiskPence: 3000,
      reconciler: ownedFiresale,
      dealCalc: quoteFrom(ownedFiresale, 3),
    },
    {
      id: "A8",
      name: "Dominant bad source suppresses a good UK source",
      setup: "A huge US PokeTrace bucket is wrong at GBP 20; 50 distinct condition-matched UK sold items are correct at GBP 100.",
      expectedHonestBehaviour: "Traceable UK exact solds should not be excluded purely because a huge approximate source disagrees by count.",
      verdict: dominantBadSource.chosenSource === "poketrace" ? "FAILS" : "SURVIVES",
      moneyAtRiskPence: 8000,
      reconciler: dominantBadSource,
      dealCalc: quoteFrom(dominantBadSource, 5000),
    },
    {
      id: "A9",
      name: "UK small sample loses to huge US baseline",
      setup: "Eight distinct condition-matched UK sold items say GBP 100; a huge US PokeTrace baseline says GBP 140.",
      expectedHonestBehaviour: "For a UK dealer, traceable UK solds should headline and the regional disagreement must force a manual decision.",
      verdict: ukSmallVsHugeUs.chosenSource === "poketrace" ? "DEGRADED" : "SURVIVES",
      moneyAtRiskPence: 4000,
      reconciler: ukSmallVsHugeUs,
      dealCalc: quoteFrom(ukSmallVsHugeUs, 5000),
    },
    {
      id: "A10",
      name: "Vintage raw single-provider confidence",
      setup: "Vintage raw Base card has one small PPT median bucket and no corroborating source.",
      expectedHonestBehaviour: "A vintage raw card should not auto-quote from one small external bucket.",
      verdict: vintageRawSingleProvider.manualCheck ? "SURVIVES" : "FAILS",
      moneyAtRiskPence: 90000,
      reconciler: vintageRawSingleProvider,
      dealCalc: quoteFrom(vintageRawSingleProvider, 7),
    },
  ];
}
