import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_PHOTO_CONTENT_TYPES,
  MAX_PHOTO_UPLOAD_BYTES,
  inventoryPhotoUploadPrefix,
  validateInventoryPhotoUploadPath,
} from "./uploadPolicy.js";

test("inventoryPhotoUploadPrefix scopes blob uploads by inventory id", () => {
  assert.equal(inventoryPhotoUploadPrefix("item-123"), "inventory/item-123/");
});

test("validateInventoryPhotoUploadPath accepts matching inventory paths", () => {
  assert.doesNotThrow(() => validateInventoryPhotoUploadPath("item-123", "inventory/item-123/front.jpg"));
});

test("validateInventoryPhotoUploadPath rejects another item path", () => {
  assert.throws(
    () => validateInventoryPhotoUploadPath("item-123", "inventory/item-999/front.jpg"),
    /does not match/,
  );
});

test("photo upload policy allows mobile-friendly image content types", () => {
  assert.deepEqual([...ALLOWED_PHOTO_CONTENT_TYPES], ["image/jpeg", "image/png", "image/webp"]);
  assert.equal(MAX_PHOTO_UPLOAD_BYTES, 4 * 1024 * 1024);
});
