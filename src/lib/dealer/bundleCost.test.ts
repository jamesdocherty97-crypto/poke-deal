import assert from "node:assert/strict";
import test from "node:test";

import { splitTotalCostToUnitPence } from "./bundleCost.js";

test("splitTotalCostToUnitPence converts a bundle total into a per-unit cost", () => {
  assert.deepEqual(splitTotalCostToUnitPence(1800, 2), {
    unitCostPence: 900,
    representedTotalPence: 1800,
    roundingDeltaPence: 0,
  });
});

test("splitTotalCostToUnitPence reports penny rounding when the total cannot split evenly", () => {
  assert.deepEqual(splitTotalCostToUnitPence(1000, 3), {
    unitCostPence: 333,
    representedTotalPence: 999,
    roundingDeltaPence: -1,
  });
});

test("splitTotalCostToUnitPence rejects missing totals or quantities", () => {
  assert.equal(splitTotalCostToUnitPence(0, 2), null);
  assert.equal(splitTotalCostToUnitPence(1000, 0), null);
});
