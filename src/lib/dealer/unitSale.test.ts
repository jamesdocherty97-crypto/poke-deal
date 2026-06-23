import assert from "node:assert/strict";
import test from "node:test";

import { planUnitSale } from "./unitSale.js";

test("planUnitSale fully sells a single-copy stock row", () => {
  assert.deepEqual(planUnitSale({ quantity: 1, status: "LISTED" }), {
    remainingQuantity: 1,
    status: "SOLD",
    closeOpenListings: true,
    fullySold: true,
  });
});

test("planUnitSale decrements duplicate stock without closing listings", () => {
  assert.deepEqual(planUnitSale({ quantity: 3, status: "LISTED" }), {
    remainingQuantity: 2,
    status: "LISTED",
    closeOpenListings: false,
    fullySold: false,
  });
});

test("planUnitSale rejects already sold stock", () => {
  assert.throws(() => planUnitSale({ quantity: 1, status: "SOLD" }), /already sold/);
});
