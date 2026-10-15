import assert from "node:assert/strict";
import test from "node:test";

import { allocatePence, buildSalePreview, planSaleUndo, planUnitSale, splitPence } from "./unitSale.js";

test("planUnitSale fully sells a single-copy stock row", () => {
  assert.deepEqual(planUnitSale({ quantity: 1, status: "LISTED" }), {
    soldQuantity: 1,
    remainingQuantity: 1,
    status: "SOLD",
    closeOpenListings: true,
    fullySold: true,
  });
});

test("planUnitSale decrements duplicate stock without closing listings", () => {
  assert.deepEqual(planUnitSale({ quantity: 3, status: "LISTED" }), {
    soldQuantity: 1,
    remainingQuantity: 2,
    status: "LISTED",
    closeOpenListings: false,
    fullySold: false,
  });
});

test("planUnitSale sells multiple copies from a duplicate stock row", () => {
  assert.deepEqual(planUnitSale({ quantity: 4, soldQuantity: 2, status: "LISTED" }), {
    soldQuantity: 2,
    remainingQuantity: 2,
    status: "LISTED",
    closeOpenListings: false,
    fullySold: false,
  });
});

test("planUnitSale fully sells a duplicate stock row and closes listings", () => {
  assert.deepEqual(planUnitSale({ quantity: 3, soldQuantity: 3, status: "LISTED" }), {
    soldQuantity: 3,
    remainingQuantity: 3,
    status: "SOLD",
    closeOpenListings: true,
    fullySold: true,
  });
});

test("planUnitSale rejects already sold stock", () => {
  assert.throws(() => planUnitSale({ quantity: 1, status: "SOLD" }), /already sold/);
});

test("planUnitSale rejects impossible sold quantities", () => {
  assert.throws(() => planUnitSale({ quantity: 2, soldQuantity: 0, status: "IN_STOCK" }), /above 0/);
  assert.throws(() => planUnitSale({ quantity: 2, soldQuantity: 3, status: "IN_STOCK" }), /exceed stock/);
});

test("planSaleUndo restores a fully sold row as one active copy", () => {
  assert.deepEqual(planSaleUndo({ quantity: 3, status: "SOLD" }), {
    quantity: 1,
    status: "IN_STOCK",
    restoredQuantity: 1,
  });
});

test("planSaleUndo increments active duplicate stock", () => {
  assert.deepEqual(planSaleUndo({ quantity: 2, status: "LISTED" }), {
    quantity: 3,
    status: "LISTED",
    restoredQuantity: 1,
  });
});

test("splitPence preserves exact totals across unit sale records", () => {
  assert.deepEqual(splitPence(1000, 3), [334, 333, 333]);
  assert.equal(splitPence(1299, 4).reduce((sum, value) => sum + value, 0), 1299);
});

test("buildSalePreview summarizes net profit, ROI and margin", () => {
  assert.deepEqual(
    buildSalePreview({
      salePricePence: 5000,
      feesPence: 650,
      postagePence: 175,
      unitCostPence: 3000,
      soldQuantity: 1,
    }),
    {
      soldQuantity: 1,
      netPence: 4175,
      costPence: 3000,
      profitPence: 1175,
      roiPct: 39.2,
      marginPct: 23.5,
    },
  );
});

test("buildSalePreview handles multiple sold copies", () => {
  const preview = buildSalePreview({
    salePricePence: 9000,
    feesPence: 900,
    postagePence: 175,
    unitCostPence: 2000,
    soldQuantity: 3,
  });

  assert.equal(preview.costPence, 6000);
  assert.equal(preview.profitPence, 1925);
  assert.equal(preview.roiPct, 32.1);
  assert.equal(preview.marginPct, 21.4);
});

test("allocatePence splits by weight and always sums to the exact total", () => {
  assert.deepEqual(allocatePence(300, [300, 300]), [150, 150]);
  assert.deepEqual(allocatePence(500, [300, 0]), [500, 0]);
  assert.deepEqual(allocatePence(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocatePence(301, [0, 0]), [151, 150], "no positive weight splits evenly");
  assert.deepEqual(allocatePence(0, [5, 7]), [0, 0]);
  assert.deepEqual(allocatePence(10, []), []);
  let seed = 7;
  const next = (max: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
  for (let round = 0; round < 2000; round += 1) {
    const total = next(2_000_000);
    const weights = Array.from({ length: 1 + next(9) }, () => (next(4) === 0 ? 0 : next(5_000_000)));
    const parts = allocatePence(total, weights);
    assert.equal(parts.reduce((sum, part) => sum + part, 0), total);
    assert.ok(parts.every((part) => Number.isSafeInteger(part) && part >= 0));
    if (weights.some((weight) => weight > 0)) {
      assert.ok(parts.every((part, index) => weights[index] !== 0 || part === 0), "zero-weight lines get nothing when another line has weight");
    }
  }
});
