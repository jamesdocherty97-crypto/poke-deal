import assert from "node:assert/strict";
import test from "node:test";

import { buildBuyPlan, buildBuyTargetSuggestion } from "./buyPlan.js";

test("buildBuyPlan accounts for eBay fees and postage per unit", () => {
  const plan = buildBuyPlan({
    unitCostPence: 1800,
    quantity: 2,
    listPricePence: 5000,
    channel: "EBAY",
  });

  assert.equal(plan.label, "Buy");
  assert.equal(plan.tone, "good");
  assert.equal(plan.unitListPence, 5000);
  assert.equal(plan.unitGrossSalePence, 5175);
  assert.equal(plan.unitFeesPence, 692);
  assert.equal(plan.unitPostagePence, 175);
  assert.equal(plan.unitNetPence, 4308);
  assert.equal(plan.unitProfitPence, 2508);
  assert.equal(plan.totalProfitPence, 5016);
  assert.equal(plan.roiPct, 139.3);
  assert.equal(plan.marginPct, 48.5);
});

test("buildBuyPlan can account for slab postage", () => {
  const plan = buildBuyPlan({
    unitCostPence: 1800,
    quantity: 1,
    listPricePence: 5000,
    channel: "EBAY",
    grade: "PSA_10",
  });

  assert.equal(plan.unitGrossSalePence, 5499);
  assert.equal(plan.unitPostagePence, 499);
  assert.equal(plan.unitProfitPence, 2466);
});

test("buildBuyPlan warns when profit is positive but below the ROI target", () => {
  const plan = buildBuyPlan({
    unitCostPence: 3300,
    quantity: 1,
    listPricePence: 4000,
    channel: "IN_PERSON",
    minRoiPct: 25,
  });

  assert.equal(plan.label, "Tight");
  assert.equal(plan.tone, "warn");
  assert.equal(plan.unitProfitPence, 700);
  assert.match(plan.note, /below the 25% ROI/);
});

test("buildBuyPlan rejects plans that do not clear costs", () => {
  const plan = buildBuyPlan({
    unitCostPence: 3000,
    quantity: 1,
    listPricePence: 3200,
    channel: "EBAY",
  });

  assert.equal(plan.label, "Pass");
  assert.equal(plan.tone, "danger");
  assert.equal(plan.unitProfitPence < 0, true);
});

test("buildBuyPlan downgrades profitable but cautious comps", () => {
  const plan = buildBuyPlan({
    unitCostPence: 1000,
    quantity: 1,
    listPricePence: 4500,
    channel: "CARDMARKET",
    cautious: true,
  });

  assert.equal(plan.label, "Check");
  assert.equal(plan.tone, "warn");
  assert.match(plan.note, /second look/);
});

test("buildBuyTargetSuggestion prefers fee-aware target buy", () => {
  const suggestion = buildBuyTargetSuggestion({
    targetBuyPence: 2436,
    compMedianPence: 5000,
    currentTargetPence: 1500,
  });

  assert.deepEqual(suggestion, {
    label: "Target buy",
    targetPence: 2436,
    note: "Keeps a 30% safety cushion after expected selling costs.",
    alreadyUsing: false,
  });
});

test("buildBuyTargetSuggestion falls back to 70 percent of comp", () => {
  const suggestion = buildBuyTargetSuggestion({
    targetBuyPence: 0,
    compMedianPence: 5000,
    currentTargetPence: 3500,
  });

  assert.deepEqual(suggestion, {
    label: "70% comp",
    targetPence: 3500,
    note: "Fallback target when fee-aware deal maths is not available.",
    alreadyUsing: true,
  });
});

test("buildBuyTargetSuggestion returns null without a priced signal", () => {
  const suggestion = buildBuyTargetSuggestion({
    targetBuyPence: 0,
    compMedianPence: 0,
    currentTargetPence: 1500,
  });

  assert.equal(suggestion, null);
});
