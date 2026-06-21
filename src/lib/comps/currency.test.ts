import { test } from "node:test";
import assert from "node:assert/strict";
import { toGbpPence, formatGbp, STATIC_RATES } from "./currency.js";

test("GBP is identity (to pence)", () => {
  assert.equal(toGbpPence(12.5, "GBP"), 1250);
});

test("EUR converts to GBP pence", () => {
  // £1 = €1.17 → €31 = £26.50
  assert.equal(toGbpPence(31, "EUR"), 2650);
});

test("USD converts to GBP pence", () => {
  // £1 = $1.27 → $35 = £27.56
  assert.equal(toGbpPence(35, "USD"), 2756);
});

test("JPY converts to GBP pence", () => {
  assert.equal(toGbpPence(192, "JPY"), 100);
});

test("unknown/zero rate throws (fail loud)", () => {
  const broken = { asOf: "x", perGbp: { GBP: 1, EUR: 0, USD: 1.27, JPY: 192 } } as typeof STATIC_RATES;
  assert.throws(() => toGbpPence(10, "EUR", broken));
});

test("formatGbp", () => {
  assert.equal(formatGbp(1250), "£12.50");
  assert.equal(formatGbp(0), "£0.00");
  assert.equal(formatGbp(-500), "-£5.00");
});
