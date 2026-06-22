import assert from "node:assert/strict";
import test from "node:test";

import {
  INVENTORY_SWIPE_MAX_OFFSET_PX,
  inventorySwipeAction,
  inventorySwipeOffset,
} from "./swipeActions.js";

test("inventorySwipeOffset ignores vertical scrolls and tiny drags", () => {
  assert.equal(inventorySwipeOffset(8, 0), 0);
  assert.equal(inventorySwipeOffset(90, 80), 0);
  assert.equal(inventorySwipeOffset(Number.NaN, 0), 0);
});

test("inventorySwipeOffset dampens and caps horizontal swipes", () => {
  assert.equal(inventorySwipeOffset(80, 12), 50);
  assert.equal(inventorySwipeOffset(-80, 12), -50);
  assert.equal(inventorySwipeOffset(400, 0), INVENTORY_SWIPE_MAX_OFFSET_PX);
  assert.equal(inventorySwipeOffset(-400, 0), -INVENTORY_SWIPE_MAX_OFFSET_PX);
});

test("inventorySwipeAction maps right to sell and left to delete", () => {
  assert.equal(inventorySwipeAction(73, 0), null);
  assert.equal(inventorySwipeAction(74, 0), "sell");
  assert.equal(inventorySwipeAction(-74, 0), "delete");
  assert.equal(inventorySwipeAction(120, 95), null);
});

test("inventorySwipeAction does not sell sold rows", () => {
  assert.equal(inventorySwipeAction(120, 0, { canSell: false }), null);
  assert.equal(inventorySwipeAction(-120, 0, { canSell: false }), "delete");
});
