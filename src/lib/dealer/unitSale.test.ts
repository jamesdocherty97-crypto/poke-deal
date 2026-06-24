import assert from "node:assert/strict";
import test from "node:test";

import { buildSalePreview, planSaleListingClosure, planSaleUndo, planUnitSale, splitPence } from "./unitSale.js";

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

test("planSaleListingClosure closes the tapped listing on partial sales", () => {
  assert.deepEqual(
    planSaleListingClosure({
      itemId: "item_1",
      soldListingId: "listing_1",
      closeOpenListings: false,
    }),
    { kind: "one", itemId: "item_1", listingId: "listing_1" },
  );
});

test("planSaleListingClosure closes all open listings when stock is fully sold", () => {
  assert.deepEqual(
    planSaleListingClosure({
      itemId: "item_1",
      soldListingId: "listing_1",
      closeOpenListings: true,
    }),
    { kind: "all-open", itemId: "item_1" },
  );
  assert.equal(
    planSaleListingClosure({
      itemId: "item_1",
      closeOpenListings: false,
    }),
    null,
  );
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
