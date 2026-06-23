import assert from "node:assert/strict";
import test from "node:test";

import { planUnitSale, splitPence } from "./unitSale.js";

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

test("splitPence preserves exact totals across unit sale records", () => {
  assert.deepEqual(splitPence(1000, 3), [334, 333, 333]);
  assert.equal(splitPence(1299, 4).reduce((sum, value) => sum + value, 0), 1299);
});
