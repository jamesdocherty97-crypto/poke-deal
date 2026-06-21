import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRepriceDigest, recommendReprice } from "./repricing.js";
import type { CompResult } from "../domain/types.js";

function comp(medianPence: number, sampleSize = 8): CompResult {
  return {
    source: "test",
    card: { name: "Charizard ex" },
    grade: "RAW",
    currency: "GBP",
    medianPence,
    meanPence: medianPence,
    lowPence: Math.round(medianPence * 0.9),
    highPence: Math.round(medianPence * 1.1),
    sampleSize,
    windowDays: 90,
    trendPct: null,
    outliersRemoved: 0,
    asOf: "2026-06-21T00:00:00.000Z",
  };
}

test("recommendReprice returns null below the movement threshold", () => {
  assert.equal(
    recommendReprice({
      itemId: "item_1",
      cardName: "Charizard ex",
      grade: "RAW",
      currentPricePence: 3000,
      costBasisPence: 1800,
      comp: comp(3150),
      thresholdPct: 10,
    }),
    null,
  );
});

test("recommendReprice recommends material price changes", () => {
  const rec = recommendReprice({
    itemId: "item_1",
    cardName: "Charizard ex",
    grade: "RAW",
    currentPricePence: 3000,
    costBasisPence: 1800,
    comp: comp(3900),
    thresholdPct: 10,
  });

  assert.equal(rec?.suggestedPricePence, 3900);
  assert.equal(rec?.movePct, 30);
  assert.match(rec?.reason ?? "", /raise/);
});

test("formatRepriceDigest is compact for Discord", () => {
  const rec = recommendReprice({
    itemId: "item_1",
    cardName: "Charizard ex",
    grade: "PSA_10",
    currentPricePence: 10000,
    costBasisPence: 7000,
    comp: comp(8500),
    thresholdPct: 10,
  });

  assert.match(formatRepriceDigest(rec ? [rec] : []), /Charizard ex PSA 10/);
  assert.equal(formatRepriceDigest([]), "No repricing actions right now.");
});
