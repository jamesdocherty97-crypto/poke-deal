import { test } from "node:test";
import assert from "node:assert/strict";
import { fitPhotoDimensions, inventoryPhotoUploadPath } from "./imageProcessing.js";

test("fitPhotoDimensions downscales landscape photos to a 1600px longest edge", () => {
  assert.deepEqual(fitPhotoDimensions(4000, 3000), { width: 1600, height: 1200 });
});

test("fitPhotoDimensions downscales portrait photos to a 1600px longest edge", () => {
  assert.deepEqual(fitPhotoDimensions(1200, 2400), { width: 800, height: 1600 });
});

test("fitPhotoDimensions leaves smaller photos unchanged", () => {
  assert.deepEqual(fitPhotoDimensions(900, 1200), { width: 900, height: 1200 });
});

test("fitPhotoDimensions rejects invalid dimensions", () => {
  assert.throws(() => fitPhotoDimensions(0, 1200), /positive/);
});

test("inventoryPhotoUploadPath scopes files under the inventory item", () => {
  assert.equal(inventoryPhotoUploadPath("item_123", 2, 1710000000000), "inventory/item_123/1710000000000-2.jpg");
});

test("inventoryPhotoUploadPath strips path characters from item ids", () => {
  assert.equal(inventoryPhotoUploadPath("../item/123", -4, 1710000000000), "inventory/item123/1710000000000-0.jpg");
});
