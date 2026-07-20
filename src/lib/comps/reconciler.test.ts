import test from "node:test";
import assert from "node:assert/strict";
import { reconcileComps, type ReconCandidate, type ReconQuery } from "./reconciler.js";

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
    valuePence: 1000,
    n: 10,
    ageDays: 7,
    region: "US",
    matchedSetId: baseQuery.setId,
    matchedCardNumber: baseQuery.cardNumber,
    matchedLanguage: "EN",
    ...overrides,
  };
}

test("T1: out-of-band smart price loses to large PokeTrace baseline and ambiguity forces manual check", () => {
  const result = reconcileComps({ ...baseQuery, ambiguous: true }, [
    candidate({ source: "pt-smart", valuePence: 11614, n: 11, region: "US", raw: { max: 9074, median: 2000 } }),
    candidate({ source: "poketrace", valuePence: 880, n: 5002, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 880);
  assert.equal(result.confidence, "medium");
  assert.equal(result.manualCheck, true);
  assert.match(result.reasons.join(" "), /smart-out-of-band/);
});

test("T2: in-band smart price is still excluded when a dominant source makes it an outlier", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "pt-smart", valuePence: 11614, n: 11, region: "US", raw: { min: 1000, max: 12000, median: 6000 } }),
    candidate({ source: "poketrace", valuePence: 880, n: 5002, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 880);
  assert.equal(result.manualCheck, true);
  assert.match(result.reasons.join(" "), /dominant-source-outlier/);
});

test("T3: vintage raw excludes tcg-market and wrong-set PokeTrace, leaving PPT median with manual check", () => {
  const result = reconcileComps({ ...baseQuery, setId: "base1", cardNumber: "4/102", isVintage: true }, [
    candidate({
      source: "tcg-market",
      valuePence: 357600,
      n: 1,
      region: "EU",
      matchedSetId: "base1",
      matchedCardNumber: "4/102",
      fields: { trendPrice: 357600, avg30: 207500 },
    }),
    candidate({ source: "poketrace", valuePence: 15300, n: 400, matchedSetId: "cel25c", matchedCardNumber: "4/102" }),
    candidate({ source: "pt-median", valuePence: 25000, n: 40, region: "US", matchedSetId: "base1", matchedCardNumber: "4/102" }),
  ]);

  assert.equal(result.headlinePence, 25000);
  assert.equal(result.confidence, "medium");
  assert.equal(result.manualCheck, true);
});

test("T4: PSA10 single source keeps headline, suppresses impossible trend, and caps confidence at medium", () => {
  const result = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10", cardNumber: "199/165", setId: "sv3pt5" }, [
    candidate({
      source: "pt-median",
      valuePence: 106200,
      n: 251,
      raw: { min: 80000, max: 140000, median: 106200 },
      trendPct: 297.9,
      trendWindowDays: 30,
      matchedSetId: "sv3pt5",
      matchedCardNumber: "199/165",
    }),
  ]);

  assert.equal(result.headlinePence, 106200);
  assert.equal(result.confidence, "medium");
  assert.equal(result.manualCheck, false);
  assert.equal(result.trendPct, null);
});

test("T4b: real Charizard ex PSA10 production bucket is medium without manual check", () => {
  const result = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10", cardNumber: "199/165", setId: "sv3pt5" }, [
    candidate({
      source: "pt-median",
      valuePence: 106220,
      n: 251,
      raw: { min: 24409, max: 188787, median: 106220, count: 251 },
      trendPct: 297.9,
      trendWindowDays: 30,
      matchedSetId: "sv3pt5",
      matchedCardNumber: "199/165",
    }),
  ]);

  assert.equal(result.headlinePence, 106220);
  assert.equal(result.confidence, "medium");
  assert.equal(result.manualCheck, false);
  assert.equal(result.trendPct, null);
  assert.match(result.reasons.join(" "), /penalty-graded-tail-spread/);
  assert.match(result.reasons.join(" "), /trend-suppressed/);
});

test("T5: strong unambiguous PokeTrace baseline can be high confidence", () => {
  const result = reconcileComps({ ...baseQuery, setId: "svp", cardNumber: "208" }, [
    candidate({ source: "poketrace", valuePence: 1282, n: 24491, matchedSetId: "svp", matchedCardNumber: "208", region: "US" }),
  ]);

  assert.equal(result.headlinePence, 1282);
  assert.equal(result.confidence, "high");
  assert.equal(result.manualCheck, false);
  assert.deepEqual(result.selection, {
    sourceTier: 0.6,
    region: "US",
    sampleSize: 24491,
    ageDays: 7,
    corroboratingCount: 0,
    appliedPenalties: ["penalty-region-us:poketrace"],
    spreadPence: 0,
    spreadPct: 0,
    lowPence: 1282,
    highPence: 1282,
    crossSourceLowPence: 1282,
    crossSourceHighPence: 1282,
    chosenBecause: "US PokeTrace · 24491 samples · 7d old · best eligible evidence",
  });
});

test("T5b: identity gate accepts ME-era zero-padded numeric card numbers", () => {
  const result = reconcileComps({ ...baseQuery, setId: "me4", cardNumber: "96/86" }, [
    candidate({
      source: "poketrace",
      valuePence: 625,
      n: 18,
      matchedSetId: "me4",
      matchedCardNumber: "096/086",
      region: "US",
    }),
  ]);

  assert.equal(result.headlinePence, 625);
  assert.doesNotMatch(result.reasons.join(" "), /identity-number/);
});

test("T5c: identity gate does not merge distinct numeric card numbers", () => {
  const result = reconcileComps({ ...baseQuery, setId: "me4", cardNumber: "10/86" }, [
    candidate({
      source: "poketrace",
      valuePence: 625,
      n: 18,
      matchedSetId: "me4",
      matchedCardNumber: "100/086",
      region: "US",
    }),
  ]);

  assert.equal(result.headlinePence, null);
  assert.match(result.reasons.join(" "), /identity-number/);
});

test("T6: contaminated Moonbreon raw bucket loses to PokeTrace and stale corroboration keeps confidence medium", () => {
  const result = reconcileComps({ ...baseQuery, setId: "swsh7", cardNumber: "215/203" }, [
    candidate({ source: "pt-smart", valuePence: 120900, n: 93, raw: { min: 35400, max: 393700, median: 110000 }, matchedCardNumber: "215/203" }),
    candidate({ source: "tcg-market", valuePence: 135000, n: 1, ageDays: 210, region: "EU", matchedCardNumber: "215/203" }),
    candidate({ source: "poketrace", valuePence: 179200, n: 365, region: "US", matchedCardNumber: "215/203" }),
  ]);

  assert.equal(result.headlinePence, 179200);
  assert.equal(result.confidence, "medium");
  assert.equal(result.manualCheck, true);
});

test("T7: UK eBay MI beats broad PokeTrace but disagreement makes it low confidence", () => {
  const result = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10" }, [
    candidate({ source: "ebay-insights", valuePence: 8000, n: 200, region: "UK", conditionMatched: true }),
    candidate({ source: "poketrace", valuePence: 12000, n: 8000, region: "US", candidateHasGradeScopedData: true }),
  ]);

  assert.equal(result.headlinePence, 8000);
  assert.equal(result.confidence, "low");
  assert.equal(result.manualCheck, true);
});

test("T8: stale-only data does not headline", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "tcg-market", valuePence: 50000, n: 1, ageDays: 200, region: "EU" }),
  ]);

  assert.equal(result.headlinePence, null);
  assert.equal(result.confidence, "low");
  assert.equal(result.manualCheck, true);
  assert.equal(result.chosenSource, undefined);
});

test("T9: non-thin owned sales anchor over external baselines", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "owned-sales", valuePence: 30000, n: 4, ageDays: 20, region: "UK" }),
    candidate({ source: "poketrace", valuePence: 22000, n: 3000, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 30000);
  assert.equal(result.confidence, "medium");
  assert.equal(result.manualCheck, false);
});

test("T9b: one or two recent owned sales corroborate but do not headline", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "owned-sales", valuePence: 30000, n: 2, ageDays: 20, region: "UK" }),
    candidate({ source: "poketrace", valuePence: 22000, n: 3000, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 22000);
  assert.equal(result.chosenSource, "poketrace");
  assert.match(result.reasons.join(" "), /corroboration-thin-owned-sales/);
});

test("T9c: three recent owned sales can headline over external baselines", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "owned-sales", valuePence: 30000, n: 3, ageDays: 20, region: "UK" }),
    candidate({ source: "poketrace", valuePence: 22000, n: 3000, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 30000);
  assert.equal(result.chosenSource, "owned-sales");
  assert.equal(result.manualCheck, false);
});

test("T9d: two recent checked comps can headline over a thin US baseline", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "checked-comps", valuePence: 10000, n: 2, ageDays: 2, region: "UK", traceableUkSales: 2, conditionMatched: true }),
    candidate({ source: "poketrace", valuePence: 8000, n: 5, ageDays: 2, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 10000);
  assert.equal(result.chosenSource, "checked-comps");
  assert.match(result.reasons.join(" "), /penalty-region-us:poketrace/);
});

test("T9e: one checked comp corroborates but cannot headline", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "checked-comps", valuePence: 10000, n: 1, ageDays: 2, region: "UK", traceableUkSales: 1, conditionMatched: true }),
    candidate({ source: "poketrace", valuePence: 8000, n: 6, ageDays: 2, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 8000);
  assert.equal(result.chosenSource, "poketrace");
  assert.match(result.reasons.join(" "), /corroboration-thin-checked-comps/);
});

test("T9f: stale checked comps decay out after 90 days", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "checked-comps", valuePence: 10000, n: 2, ageDays: 91, region: "UK", traceableUkSales: 2, conditionMatched: true }),
    candidate({ source: "poketrace", valuePence: 8000, n: 6, ageDays: 2, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 8000);
  assert.equal(result.chosenSource, "poketrace");
  assert.match(result.reasons.join(" "), /stale-checked-comps/);
});

test("T10: no candidates returns no headline and a low-confidence manual check", () => {
  const result = reconcileComps(baseQuery, []);

  assert.equal(result.headlinePence, null);
  assert.equal(result.confidence, "low");
  assert.equal(result.manualCheck, true);
});

test("T10b: stale corroboration-only data does not become a headline", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "tcg-market", valuePence: 156, n: 1, ageDays: 220, region: "EU" }),
  ]);

  assert.equal(result.headlinePence, null);
  assert.equal(result.chosenSource, undefined);
  assert.equal(result.confidence, "low");
  assert.equal(result.manualCheck, true);
  assert.match(result.reasons.join(" "), /corroboration-only:tcg-market/);
});

test("T11: agreeing sources are still low-confidence when every eligible source is heavily penalized", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "pt-median", valuePence: 10000, n: 1000, region: "UK", raw: { min: 1000, max: 10000, median: 10000 } }),
    candidate({ source: "tcg-market", valuePence: 10400, n: 1000, ageDays: 120, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 10000);
  assert.equal(result.confidence, "low");
  assert.equal(result.manualCheck, true);
});

test("T12: UK eBay MI wins over a broad non-UK PokeTrace source when both agree", () => {
  const result = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10" }, [
    candidate({ source: "ebay-insights", valuePence: 10000, n: 60, region: "UK", conditionMatched: true }),
    candidate({ source: "poketrace", valuePence: 9500, n: 5000, region: "US", candidateHasGradeScopedData: true }),
  ]);

  assert.equal(result.headlinePence, 10000);
  assert.equal(result.confidence, "high");
  assert.equal(result.manualCheck, false);
});

test("T12b: RAW eBay Insights without verified condition is corroboration only", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "ebay-insights", valuePence: 10000, n: 60, region: "UK", conditionMatched: false }),
    candidate({ source: "poketrace", valuePence: 9500, n: 50, region: "US" }),
  ]);

  assert.equal(result.chosenSource, "poketrace");
  assert.match(result.reasons.join(" "), /corroboration-unscoped-raw-condition:ebay-insights/);
});

test("T12c: disagreeing qualified UK sold sources force a manual check", () => {
  const result = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10" }, [
    candidate({ source: "ebay-insights", valuePence: 60_000, n: 6, region: "UK", conditionMatched: true }),
    candidate({ source: "checked-comps", valuePence: 45_000, n: 3, region: "UK", traceableUkSales: 3, conditionMatched: true }),
  ]);

  assert.equal(result.chosenSource, "ebay-insights");
  assert.equal(result.manualCheck, true);
  assert.match(result.reasons.join(" "), /uk-solds-disagree/);
});

test("A2-1: high-confidence spread-only signal does not force manual check", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "poketrace", valuePence: 4000, n: 10000, region: "US" }),
    candidate({ source: "tcg-market", valuePence: 7000, n: 3, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 4000);
  assert.equal(result.confidence, "high");
  assert.equal(result.manualCheck, false);
  assert.match(result.reasons.join(" "), /spread-flag-suppressed:high-confidence/);
});

test("A2-1: ambiguity still forces manual check on an otherwise high-confidence spread", () => {
  const result = reconcileComps({ ...baseQuery, ambiguous: true }, [
    candidate({ source: "poketrace", valuePence: 4000, n: 10000, region: "US" }),
    candidate({ source: "tcg-market", valuePence: 7000, n: 3, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 4000);
  assert.equal(result.manualCheck, true);
  assert.doesNotMatch(result.reasons.join(" "), /spread-flag-suppressed/);
});

test("A2-2: sub-£10 spread-only signal does not force manual check", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "poketrace", valuePence: 900, n: 180, region: "US" }),
    candidate({ source: "tcg-market", valuePence: 2000, n: 3, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 900);
  assert.equal(result.confidence, "medium");
  assert.equal(result.manualCheck, false);
  assert.match(result.reasons.join(" "), /spread-flag-suppressed:low-stakes/);
});

test("A2-2: £10+ spread-only signal still forces manual check", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "poketrace", valuePence: 1000, n: 180, region: "US" }),
    candidate({ source: "tcg-market", valuePence: 2000, n: 3, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 1000);
  assert.equal(result.confidence, "medium");
  assert.equal(result.manualCheck, true);
});

test("A2-2: sub-£10 ambiguity still forces manual check", () => {
  const result = reconcileComps({ ...baseQuery, ambiguous: true }, [
    candidate({ source: "poketrace", valuePence: 900, n: 180, region: "US" }),
    candidate({ source: "tcg-market", valuePence: 2000, n: 3, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 900);
  assert.equal(result.manualCheck, true);
  assert.doesNotMatch(result.reasons.join(" "), /spread-flag-suppressed/);
});

test("T13: graded symmetric bucket spread does not count as contamination", () => {
  const result = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10" }, [
    candidate({
      source: "pt-median",
      valuePence: 1000,
      n: 1000,
      region: "UK",
      raw: { min: 500, median: 1000, max: 1500 },
    }),
  ]);

  assert.equal(result.headlinePence, 1000);
  assert.equal(result.confidence, "medium");
  assert.equal(result.manualCheck, false);
  assert.doesNotMatch(result.reasons.join(" "), /penalty-graded-tail-spread/);
});

test("T14: graded asymmetric tail is marked as contamination but is not automatically manual-check", () => {
  const result = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10" }, [
    candidate({
      source: "pt-median",
      valuePence: 1000,
      n: 1000,
      region: "UK",
      raw: { min: 900, median: 1000, max: 3500 },
    }),
  ]);

  assert.equal(result.headlinePence, 1000);
  assert.equal(result.confidence, "medium");
  assert.equal(result.manualCheck, false);
  assert.match(result.reasons.join(" "), /penalty-graded-tail-spread/);
});

test("R3-1: stale consensus cannot auto-quote when every eligible source is older than 45 days", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "pt-smart", valuePence: 20000, n: 100, ageDays: 60, raw: { min: 18000, max: 22000, median: 20000 } }),
    candidate({ source: "tcg-market", valuePence: 20000, n: 10, ageDays: 65, region: "EU" }),
    candidate({ source: "poketrace", valuePence: 20000, n: 70, ageDays: 70, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 20000);
  assert.equal(result.manualCheck, true);
  assert.match(result.reasons.join(" "), /stale-consensus/);
});

test("R3-1: stale consensus does not fire when one eligible source is fresh", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "pt-smart", valuePence: 9000, n: 100, ageDays: 60, raw: { min: 8000, max: 10000, median: 9000 } }),
    candidate({ source: "tcg-market", valuePence: 9000, n: 10, ageDays: 45, region: "EU" }),
    candidate({ source: "poketrace", valuePence: 9000, n: 70, ageDays: 70, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 9000);
  assert.equal(result.manualCheck, false);
  assert.doesNotMatch(result.reasons.join(" "), /stale-consensus/);
});

test("R3-2: dominant outlier still excludes a thin broad-source price when it has lower effective dominance weight", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "pt-smart", valuePence: 11614, n: 11, region: "US", raw: { min: 1000, max: 12000, median: 6000 } }),
    candidate({ source: "poketrace", valuePence: 880, n: 5002, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 880);
  assert.match(result.reasons.join(" "), /dominant-source-outlier:pt-smart:vs:poketrace/);
});

test("R3-2: a huge US baseline cannot exclude a higher-trust UK eBay sold source", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "poketrace", valuePence: 2000, n: 5000, ageDays: 3, region: "US" }),
    candidate({ source: "ebay-insights", valuePence: 10000, n: 8, ageDays: 2, region: "UK", conditionMatched: true }),
  ]);

  assert.doesNotMatch(result.reasons.join(" "), /dominant-source-outlier:ebay-insights/);
  assert.equal(result.chosenSource, "ebay-insights");
  assert.equal(result.manualCheck, true);
  assert.match(result.reasons.join(" "), /uk-solds-disagree/);
});

test("R3-3: graded adjacent lower-grade aggregate near the queried grade forces manual check", () => {
  const result = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10" }, [
    candidate({ source: "pt-median", valuePence: 10500, n: 80, adjacentLowerGradeMedianPence: 10000 }),
  ]);

  assert.equal(result.headlinePence, 10500);
  assert.equal(result.manualCheck, true);
  assert.match(result.reasons.join(" "), /grade-bleed-suspect/);
});

test("R3-3: graded adjacent lower-grade aggregate well below the queried grade is not flagged", () => {
  const result = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10" }, [
    candidate({ source: "pt-median", valuePence: 15000, n: 80, adjacentLowerGradeMedianPence: 10000 }),
  ]);

  assert.equal(result.manualCheck, false);
  assert.doesNotMatch(result.reasons.join(" "), /grade-bleed-suspect/);
});

test("R3-3: missing adjacent lower-grade aggregate leaves graded behaviour unchanged", () => {
  const result = reconcileComps({ ...baseQuery, gradeBucket: "PSA_10" }, [
    candidate({ source: "pt-median", valuePence: 10500, n: 80 }),
  ]);

  assert.equal(result.manualCheck, false);
  assert.doesNotMatch(result.reasons.join(" "), /grade-bleed-suspect/);
});

test("R3-4: aged FX flags high-value converted headlines", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "poketrace", valuePence: 100000, n: 500, convertedFromNonGbp: true, fxAgeDays: 6 }),
  ]);

  assert.equal(result.manualCheck, true);
  assert.match(result.reasons.join(" "), /fx-aged/);
});

test("R3-4: aged FX is disclosed but does not block low-value converted headlines", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "poketrace", valuePence: 8000, n: 500, convertedFromNonGbp: true, fxAgeDays: 6 }),
  ]);

  assert.equal(result.manualCheck, false);
  assert.match(result.reasons.join(" "), /fx-aged/);
});

test("R3-4: fresh FX leaves converted headlines unchanged", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "poketrace", valuePence: 8000, n: 500, convertedFromNonGbp: true, fxAgeDays: 1 }),
  ]);

  assert.equal(result.manualCheck, false);
  assert.doesNotMatch(result.reasons.join(" "), /fx-aged/);
});

test("R3-5: qualified UK sold evidence headlines and surfaces foreign-market disagreement", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "ebay-insights", valuePence: 7500, n: 8, ageDays: 2, region: "UK", conditionMatched: true }),
    candidate({ source: "poketrace", valuePence: 10000, n: 5000, ageDays: 2, region: "US" }),
  ]);

  assert.equal(result.chosenSource, "ebay-insights");
  assert.equal(result.manualCheck, true);
  assert.match(result.reasons.join(" "), /uk-solds-disagree/);
});

test("R3-5: nearby UK sold evidence does not force manual check", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "ebay-insights", valuePence: 9200, n: 8, ageDays: 2, region: "UK", conditionMatched: true }),
    candidate({ source: "poketrace", valuePence: 10000, n: 5000, ageDays: 2, region: "US" }),
  ]);

  assert.equal(result.chosenSource, "ebay-insights");
  assert.equal(result.manualCheck, false);
  assert.doesNotMatch(result.reasons.join(" "), /uk-solds-disagree/);
});

test("approximate provider counts are reliability-capped without changing the reported evidence", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "poketrace", valuePence: 1300, n: 24000, sampleSizeApproximate: true }),
  ]);

  assert.equal(result.manualCheck, false);
  assert.equal(result.confidence, "medium");
  assert.equal(result.selection?.sampleSize, 50);
  assert.equal(result.selection?.reportedSampleSize, 24000);
  assert.match(result.reasons.join(" "), /approximate-sample-capped:24000-to-50:poketrace/);
});
