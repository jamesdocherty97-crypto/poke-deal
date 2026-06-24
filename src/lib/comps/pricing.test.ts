import { test } from "node:test";
import assert from "node:assert/strict";
import { conditionAdjustedPricePence, rawConditionPriceFactor, suggestListPrice, realizedProfit } from "./pricing.js";
import type { CompResult } from "../domain/types.js";

function comp(medianPence: number, sampleSize = 8): CompResult {
  return {
    source: "test",
    card: { name: "Charizard ex" },
    grade: "RAW",
    currency: "GBP",
    medianPence,
    meanPence: medianPence,
    lowPence: Math.round(medianPence * 0.8),
    highPence: Math.round(medianPence * 1.2),
    sampleSize,
    windowDays: 90,
    trendPct: 5,
    outliersRemoved: 1,
    asOf: "2026-06-21T00:00:00.000Z",
  };
}

test("market strategy prices at median when above floor", () => {
  const s = suggestListPrice({ comp: comp(3000), strategy: "market", costBasisPence: 1800 });
  assert.equal(s.pricePence, 3000);
  assert.equal(s.confidence, "high");
  assert.equal(s.flooredToMargin, false);
});

test("quick and patient nudge around median", () => {
  assert.equal(suggestListPrice({ comp: comp(3000), strategy: "quick" }).pricePence, 2550);
  assert.equal(suggestListPrice({ comp: comp(3000), strategy: "patient" }).pricePence, 3450);
});

test("cost-basis floor protects minimum margin", () => {
  // soft market (£10) but I paid £18 → must list at cost + 10% = £19.80
  const s = suggestListPrice({ comp: comp(1000), strategy: "market", costBasisPence: 1800, minMargin: 0.1 });
  assert.equal(s.pricePence, 1980);
  assert.equal(s.flooredToMargin, true);
});

test("raw condition discounts NM-ish comps before pricing", () => {
  const lp = suggestListPrice({ comp: comp(3000), strategy: "market", condition: "LP" });
  const mp = suggestListPrice({ comp: comp(3000), strategy: "market", condition: "moderately played" });

  assert.equal(lp.pricePence, 2550);
  assert.match(lp.rationale, /Raw LP adjustment/);
  assert.equal(mp.pricePence, 2100);
  assert.equal(rawConditionPriceFactor("RAW", "HP"), 0.55);
  assert.equal(rawConditionPriceFactor("RAW", "damaged"), 0.4);
});

test("condition discount does not apply to graded cards", () => {
  const slab = { ...comp(3000), grade: "PSA_10" as const };
  const priced = suggestListPrice({ comp: slab, strategy: "market", condition: "LP" });

  assert.equal(priced.pricePence, 3000);
  assert.equal(conditionAdjustedPricePence(3000, "PSA_10", "LP"), 3000);
});

test("thin sample is flagged low confidence", () => {
  const s = suggestListPrice({ comp: comp(3000, 2) });
  assert.equal(s.confidence, "low");
});

test("no comps falls back to cost + margin with 'none' confidence", () => {
  const s = suggestListPrice({ comp: comp(0, 0), costBasisPence: 1800 });
  assert.equal(s.confidence, "none");
  assert.equal(s.pricePence, 1980);
});

test("realized profit nets fees, postage and cost", () => {
  assert.equal(
    realizedProfit({ salePrice: 3000, fees: 414, postage: 120, costBasis: 1800 }),
    666,
  );
});
