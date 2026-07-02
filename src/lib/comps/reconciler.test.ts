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

test("T5: strong unambiguous PokeTrace baseline can be high confidence", () => {
  const result = reconcileComps({ ...baseQuery, setId: "svp", cardNumber: "208" }, [
    candidate({ source: "poketrace", valuePence: 1282, n: 24491, matchedSetId: "svp", matchedCardNumber: "208", region: "US" }),
  ]);

  assert.equal(result.headlinePence, 1282);
  assert.equal(result.confidence, "high");
  assert.equal(result.manualCheck, false);
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
  const result = reconcileComps(baseQuery, [
    candidate({ source: "ebay-insights", valuePence: 8000, n: 200, region: "UK" }),
    candidate({ source: "poketrace", valuePence: 12000, n: 8000, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 8000);
  assert.equal(result.confidence, "low");
  assert.equal(result.manualCheck, true);
});

test("T8: stale-only data can fallback but always needs manual check", () => {
  const result = reconcileComps(baseQuery, [
    candidate({ source: "tcg-market", valuePence: 50000, n: 1, ageDays: 200, region: "EU" }),
  ]);

  assert.equal(result.headlinePence, 50000);
  assert.equal(result.confidence, "low");
  assert.equal(result.manualCheck, true);
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

test("T10: no candidates returns no headline and a low-confidence manual check", () => {
  const result = reconcileComps(baseQuery, []);

  assert.equal(result.headlinePence, null);
  assert.equal(result.confidence, "low");
  assert.equal(result.manualCheck, true);
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
  const result = reconcileComps(baseQuery, [
    candidate({ source: "ebay-insights", valuePence: 10000, n: 60, region: "UK" }),
    candidate({ source: "poketrace", valuePence: 9500, n: 5000, region: "US" }),
  ]);

  assert.equal(result.headlinePence, 10000);
  assert.equal(result.confidence, "high");
  assert.equal(result.manualCheck, false);
});
