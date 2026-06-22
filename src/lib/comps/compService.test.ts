import test from "node:test";
import assert from "node:assert/strict";
import { detectDisagreement, pickHeadline } from "./compService.js";
import type { CompResult } from "../domain/types.js";

function comp(overrides: Partial<CompResult>): CompResult {
  return {
    source: "test-source",
    card: { name: "Charizard ex", setName: "151", number: "199/165" },
    grade: "RAW",
    currency: "GBP",
    medianPence: 3000,
    meanPence: 3000,
    lowPence: 2500,
    highPence: 3500,
    sampleSize: 8,
    windowDays: 90,
    trendPct: null,
    outliersRemoved: 0,
    asOf: "2026-06-22T00:00:00.000Z",
    ...overrides,
  };
}

test("pickHeadline prefers smart RAW price over a larger ordinary raw bucket", () => {
  const noisyRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 9000,
    sampleSize: 20,
    raw: { chosenPriceSource: "medianPrice" },
  });
  const smartRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 2800,
    sampleSize: 5,
    raw: { chosenPriceSource: "smartMarketPrice" },
  });

  assert.equal(pickHeadline([noisyRaw, smartRaw]), smartRaw);
});

test("pickHeadline uses catalog market baseline when raw eBay bucket disagrees without smart price", () => {
  const noisyRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 12000,
    sampleSize: 14,
    raw: { chosenPriceSource: "medianPrice" },
  });
  const catalogBaseline = comp({
    source: "pokemon-tcg-market",
    medianPence: 2400,
    meanPence: 2400,
    lowPence: 2400,
    highPence: 2400,
    sampleSize: 1,
    windowDays: 30,
    raw: { kind: "catalog-market-baseline" },
  });

  assert.equal(detectDisagreement([noisyRaw, catalogBaseline]), true);
  assert.equal(pickHeadline([noisyRaw, catalogBaseline]), catalogBaseline);
});

test("pickHeadline keeps confident graded comps on sample size", () => {
  const psaSmall = comp({ grade: "PSA_10", medianPence: 11000, sampleSize: 4 });
  const psaLarge = comp({ grade: "PSA_10", medianPence: 11500, sampleSize: 10 });

  assert.equal(pickHeadline([psaSmall, psaLarge]), psaLarge);
});
