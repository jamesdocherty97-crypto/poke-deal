import assert from "node:assert/strict";
import test from "node:test";

import { buildLaunchPlan, buildLaunchProgress } from "./launchPlan.js";

test("buildLaunchPlan starts a new business with stock, costs and source work", () => {
  const plan = buildLaunchPlan({
    stockCount: 0,
    draftListings: 0,
    activeListings: 0,
    soldCount: 0,
    activeWatches: 0,
    operatingExpensePence: 0,
    secondaryCrossCheck: false,
    alertDelivery: false,
  });

  assert.deepEqual(plan.map((item) => item.id), [
    "first-stock",
    "setup-costs",
    "source-target",
    "second-source",
  ]);
  assert.equal(plan[0]?.target, "opening-stock");
  assert.equal(plan[0]?.action, "Import");
  assert.equal(plan.find((item) => item.id === "second-source")?.state, "warn");
});

test("buildLaunchPlan prioritizes draft activation and first sale", () => {
  const plan = buildLaunchPlan({
    stockCount: 4,
    draftListings: 3,
    activeListings: 1,
    soldCount: 0,
    activeWatches: 1,
    operatingExpensePence: 2500,
    secondaryCrossCheck: true,
    alertDelivery: false,
  });

  assert.deepEqual(plan.map((item) => item.id), ["activate-drafts", "first-sale"]);
  assert.equal(plan[0]?.target, "listings");
  assert.equal(plan[1]?.target, "listings");
});

test("buildLaunchPlan waits for setup status before warning about source setup", () => {
  const plan = buildLaunchPlan({
    stockCount: 0,
    draftListings: 0,
    activeListings: 0,
    soldCount: 0,
    activeWatches: 0,
    operatingExpensePence: 0,
    setupKnown: false,
    secondaryCrossCheck: false,
    alertDelivery: false,
  });

  assert.equal(plan.some((item) => item.id === "second-source"), false);
});

test("buildLaunchPlan returns an operating rhythm once the loop is live", () => {
  const plan = buildLaunchPlan({
    stockCount: 8,
    draftListings: 0,
    activeListings: 5,
    soldCount: 2,
    activeWatches: 2,
    operatingExpensePence: 3500,
    secondaryCrossCheck: true,
    alertDelivery: true,
  });

  assert.deepEqual(plan.map((item) => item.id), ["weekly-rhythm"]);
  assert.equal(plan[0]?.state, "done");
  assert.equal(plan[0]?.target, "profit");
});

test("buildLaunchPlan caps lower priority work", () => {
  const plan = buildLaunchPlan(
    {
      stockCount: 2,
      draftListings: 0,
      activeListings: 0,
      soldCount: 0,
      activeWatches: 0,
      operatingExpensePence: 0,
      secondaryCrossCheck: false,
      alertDelivery: false,
    },
    3,
  );

  assert.deepEqual(plan.map((item) => item.id), ["first-listings", "setup-costs", "source-target"]);
});

test("buildLaunchProgress summarizes setup completion and next milestone", () => {
  const progress = buildLaunchProgress({
    stockCount: 3,
    draftListings: 1,
    activeListings: 0,
    soldCount: 0,
    activeWatches: 0,
    operatingExpensePence: 1250,
    setupKnown: true,
    secondaryCrossCheck: true,
    alertDelivery: false,
  });

  assert.equal(progress.doneCount, 4);
  assert.equal(progress.totalCount, 6);
  assert.equal(progress.label, "4/6 ready");
  assert.equal(progress.nextLabel, "Next: first sale");
});

test("buildLaunchProgress does not punish unknown setup before source status loads", () => {
  const progress = buildLaunchProgress({
    stockCount: 0,
    draftListings: 0,
    activeListings: 0,
    soldCount: 0,
    activeWatches: 0,
    operatingExpensePence: 0,
    setupKnown: false,
    secondaryCrossCheck: false,
    alertDelivery: false,
  });

  assert.equal(progress.doneCount, 1);
  assert.equal(progress.nextLabel, "Next: stock ledger");
});
