import assert from "node:assert/strict";
import test from "node:test";

import {
  collectorNumberCompareForms,
  collectorNumbersEquivalent,
  normalizeCollectorNumberForCompare,
  stripProviderSetCodePrefix,
} from "./identity.js";

test("canonical collector-number equivalence strips numeric leading zeros only", () => {
  assert.equal(normalizeCollectorNumberForCompare("069/086"), "69/86");
  assert.equal(normalizeCollectorNumberForCompare("096/086"), "96/86");
  assert.equal(normalizeCollectorNumberForCompare("TG06/TG30"), "TG06/TG30");
  assert.equal(normalizeCollectorNumberForCompare("SVP 208"), "SVP208");
});

test("collectorNumbersEquivalent handles numeric padding without false positives", () => {
  assert.equal(collectorNumbersEquivalent("069/086", "69/86"), true);
  assert.equal(collectorNumbersEquivalent("096/086", "96/86"), true);
  assert.equal(collectorNumbersEquivalent("10/86", "100/86"), false);
  assert.equal(collectorNumbersEquivalent("232", "232/091"), true);
});

test("collectorNumberCompareForms leaves gallery prefixes intact", () => {
  assert.deepEqual([...collectorNumberCompareForms("TG06/TG30")].sort(), ["TG06", "TG06/TG30"].sort());
  assert.deepEqual([...collectorNumberCompareForms("GG30/GG70")].sort(), ["GG30", "GG30/GG70"].sort());
});

test("provider set prefixes are stripped for comparison only", () => {
  assert.equal(stripProviderSetCodePrefix("ME04: Chaos Rising"), "Chaos Rising");
  assert.equal(stripProviderSetCodePrefix("Chaos Rising"), "Chaos Rising");
  assert.equal(stripProviderSetCodePrefix("SV: Scarlet & Violet 151"), "SV: Scarlet & Violet 151");
});
