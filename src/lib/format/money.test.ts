import assert from "node:assert/strict";
import test from "node:test";
import { formatGbp } from "./money.js";

test("formatGbp renders pence consistently for app-facing copy", () => {
  assert.equal(formatGbp(0), "£0.00");
  assert.equal(formatGbp(1250), "£12.50");
  assert.equal(formatGbp(1255.4), "£12.55");
  assert.equal(formatGbp(-999), "-£9.99");
  assert.equal(formatGbp(null), "£0.00");
  assert.equal(formatGbp(Number.NaN), "£0.00");
});
