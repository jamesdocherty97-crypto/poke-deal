import assert from "node:assert/strict";
import test from "node:test";
import { formatGbp, gbpPence, penceToPounds, POUNDS_TOO_LARGE_MESSAGE, poundsFieldMessage, poundsToPence, readFormPence, roundHalfUpPence } from "./money.js";

test("formatGbp renders pence consistently for app-facing copy", () => {
  assert.equal(formatGbp(0), "£0.00");
  assert.equal(formatGbp(1250), "£12.50");
  assert.equal(formatGbp(1255.4), "£12.55");
  assert.equal(formatGbp(-999), "-£9.99");
  assert.equal(formatGbp(null), "£0.00");
  assert.equal(formatGbp(Number.NaN), "£0.00");
});

test("pound text and half-up rounding share one integer pence rule", () => {
  assert.equal(penceOf("12.50"), 1250);
  assert.equal(penceOf("£12.50"), 1250);
  assert.equal(penceOf("1.005"), 101);
  assert.equal(penceOf("-0.005"), -1);
  assert.equal(penceOf("-2.675"), -268);
  assert.equal(penceOf(""), 0);
  assert.equal(penceOf("not a price"), 0);
  assert.equal(penceToPounds(1250), "12.50");
  assert.equal(roundHalfUpPence(1.005), penceOf("1.005"));
  assert.equal(gbpPence(1250), 1250);
  assert.throws(() => gbpPence(12.5), /safe integer/);
  assert.throws(() => gbpPence(Number.NaN), /safe integer/);
  assert.throws(() => roundHalfUpPence(Number.POSITIVE_INFINITY), /non-finite/);
  assert.throws(() => roundHalfUpPence(1e16), /safe integer/);
});

test("very long pound text is invalid and does not throw during render", () => {
  const longInputs = [
    "100000000000000",
    "9".repeat(15),
    "9".repeat(80),
    `-${"9".repeat(20)}`,
    `${"1".repeat(30)}.99`,
  ];
  for (const value of longInputs) {
    assert.doesNotThrow(() => poundsToPence(value));
    const parsed = poundsToPence(value);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.message, POUNDS_TOO_LARGE_MESSAGE);
    assert.equal(readFormPence(value), null);
    assert.equal(poundsFieldMessage(value), POUNDS_TOO_LARGE_MESSAGE);
  }
  assert.equal(penceOf("100000000000.00"), 10_000_000_000_000);
});

function penceOf(value: string): number {
  const parsed = poundsToPence(value);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("expected integer pence");
  return parsed.pence;
}
