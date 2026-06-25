import assert from "node:assert/strict";
import test from "node:test";

import { judgeDeal } from "./dealJudge.js";

test("judgeDeal shows a max offer before cost is entered", () => {
  const result = judgeDeal({ medianPence: 5000, sampleSize: 8 }, 0, "EBAY", "RAW", "NM");

  assert.equal(result.label, "Max offer");
  assert.equal(result.tone, "warn");
  assert.equal(result.expectedProfitPence, 0);
  assert.equal(result.targetBuyPence, 3016);
});

test("judgeDeal turns into profit judgement once cost is entered", () => {
  const result = judgeDeal({ medianPence: 5000, sampleSize: 8 }, 1800, "EBAY", "RAW", "NM");

  assert.equal(result.label, "Buy");
  assert.equal(result.tone, "good");
  assert.equal(result.expectedProfitPence, 2508);
  assert.equal(result.targetBuyPence, 3016);
});

test("judgeDeal respects raw condition when setting a buy ceiling", () => {
  const result = judgeDeal({ medianPence: 5000, sampleSize: 8 }, 0, "EBAY", "RAW", "LP");

  assert.equal(result.label, "Max offer");
  assert.equal(result.targetBuyPence, 2558);
});

test("judgeDeal returns no signal for unpriced comps", () => {
  assert.deepEqual(judgeDeal({ medianPence: 0, sampleSize: 0 }, 1000, "EBAY", "RAW", "NM"), {
    label: "No signal",
    tone: "danger",
    expectedProfitPence: 0,
    targetBuyPence: 0,
  });
});
