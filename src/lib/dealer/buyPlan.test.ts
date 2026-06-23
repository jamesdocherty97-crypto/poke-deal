import assert from "node:assert/strict";
import test from "node:test";

import { buildBuyPlan } from "./buyPlan.js";

test("buildBuyPlan accounts for eBay fees and postage per unit", () => {
  const plan = buildBuyPlan({
    unitCostPence: 1800,
    quantity: 2,
    listPricePence: 5000,
    channel: "EBAY",
  });

  assert.equal(plan.label, "Buy");
  assert.equal(plan.tone, "good");
  assert.equal(plan.unitFeesPence, 670);
  assert.equal(plan.unitPostagePence, 120);
  assert.equal(plan.unitNetPence, 4210);
  assert.equal(plan.unitProfitPence, 2410);
  assert.equal(plan.totalProfitPence, 4820);
  assert.equal(plan.roiPct, 133.9);
  assert.equal(plan.marginPct, 48.2);
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
