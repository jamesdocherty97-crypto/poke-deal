import assert from "node:assert/strict";
import test from "node:test";
import { formatGbp, gbpPence, penceToPounds, poundsToPence, roundHalfUpPence } from "./money.js";

test("formatGbp renders pence consistently for app-facing copy", () => {
  assert.equal(formatGbp(0), "£0.00");
  assert.equal(formatGbp(1250), "£12.50");
  assert.equal(formatGbp(1255.4), "£12.55");
  assert.equal(formatGbp(-999), "-£9.99");
  assert.equal(formatGbp(null), "£0.00");
  assert.equal(formatGbp(Number.NaN), "£0.00");
});

test("pound text and half-up rounding share one integer pence rule", () => {
  assert.equal(poundsToPence("12.50"), 1250);
  assert.equal(poundsToPence("£12.50"), 1250);
  assert.equal(poundsToPence("1.005"), 101);
  assert.equal(poundsToPence(""), 0);
  assert.equal(poundsToPence("not a price"), 0);
  assert.equal(penceToPounds(1250), "12.50");
  assert.equal(roundHalfUpPence(1.005), poundsToPence("1.005"));
  assert.equal(gbpPence(1250), 1250);
  assert.throws(() => gbpPence(12.5), /safe integer/);
  assert.throws(() => gbpPence(Number.NaN), /safe integer/);
  assert.throws(() => roundHalfUpPence(Number.POSITIVE_INFINITY), /non-finite/);
});
