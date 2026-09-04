import assert from "node:assert/strict";
import test from "node:test";

import { buildLaunchPlan, buildLaunchProgress, buildSellingMission, summarizeSellingStock, type LaunchPlanInput } from "./launchPlan.js";

const empty: LaunchPlanInput = {
  stockCount: 0, draftListings: 0, preparedDrafts: 0, activeListings: 0, soldCount: 0,
  activeWatches: 0, operatingExpensePence: 0, secondaryCrossCheck: false, alertDelivery: false,
};

test("a new dealer starts with physical stock instead of buying targets or provider setup", () => {
  const plan = buildLaunchPlan(empty);
  assert.deepEqual(plan.map((item) => item.id), ["first-stock"]);
  assert.equal(plan[0]?.target, "opening-stock");
  assert.equal(buildLaunchProgress(empty).doneCount, 0);
  assert.equal(buildLaunchProgress({ ...empty, setupKnown: false }).doneCount, 0);
});

test("a draft must be prepared before it counts as a readiness milestone", () => {
  const draft = { ...empty, stockCount: 3, draftListings: 1 };
  assert.equal(buildLaunchProgress(draft).doneCount, 1);
  assert.equal(buildLaunchProgress(draft).nextLabel, "Next: a prepared listing");
  assert.match(buildLaunchPlan(draft)[0]!.title, /Finish/);
  const prepared = { ...draft, preparedDrafts: 1 };
  assert.equal(buildLaunchProgress(prepared).doneCount, 2);
  assert.equal(buildLaunchProgress(prepared).nextLabel, "Next: a live listing");
  assert.match(buildLaunchPlan(prepared)[0]!.detail, /export alone is not live/);
});

test("prepared drafts and paid-sale work outrank optional operating cost entry", () => {
  const plan = buildLaunchPlan({ ...empty, stockCount: 4, draftListings: 3, preparedDrafts: 2, activeListings: 1 });
  assert.deepEqual(plan.map((item) => item.id), ["activate-drafts", "first-sale", "setup-costs"]);
  assert.match(plan[1]!.detail, /only after the buyer pays/);
});

test("research configuration never changes first-sale completion", () => {
  const operation = { ...empty, stockCount: 8, activeListings: 5, soldCount: 2, operatingExpensePence: 3500 };
  const research = { ...operation, activeWatches: 2, secondaryCrossCheck: true, alertDelivery: true };
  assert.deepEqual(buildLaunchPlan(operation), buildLaunchPlan(research));
  assert.deepEqual(buildLaunchProgress(operation), buildLaunchProgress(research));
  assert.equal(buildLaunchProgress(operation).label, "4/4 milestones");
});

test("selling out preserves completed milestones when live listing history is retained", () => {
  const soldOut = { ...empty, soldCount: 2, previouslyLiveListings: 2, operatingExpensePence: 250 };
  assert.equal(buildLaunchProgress(soldOut).doneCount, 4);
  assert.equal(buildLaunchPlan(soldOut).some((item) => item.id === "first-stock"), false);
  assert.equal(buildLaunchPlan(soldOut)[0]!.id, "weekly-rhythm");
  assert.deepEqual(buildLaunchPlan({ ...soldOut, stockCount: 2, sellableStockCount: 0 }).map((item) => item.id), ["weekly-rhythm"]);
});

test("the launch plan remains bounded to the requested number of business actions", () => {
  assert.equal(buildLaunchPlan({ ...empty, stockCount: 4, draftListings: 2, activeListings: 1 }, 2).length, 2);
});

test("selling stock counts incomplete drafts, prepared drafts and confirmed live rows separately", () => {
  const photo = { url: "https://example.test/card.jpg", origin: "REAL" as const };
  const card = { status: "IN_STOCK", grade: "RAW", condition: "NM", photos: [photo] };
  const draft = { state: "DRAFT", channel: "EBAY", listPrice: 2500 };
  const live = { ...draft, state: "ACTIVE", externalUrl: "https://www.ebay.co.uk/itm/123" };
  const summary = summarizeSellingStock([
    { ...card, condition: null, listings: [draft] },
    { ...card, listings: [draft] },
    { ...card, status: "LISTED", listings: [live] },
    { ...card, status: "SOLD", listings: [live] },
    { ...card, status: "RESERVED", listings: [draft] },
  ]);
  assert.deepEqual(summary, { totalRows: 5, availableRows: 3, heldRows: 1, preparationRows: 1, preparedDrafts: 1, liveRows: 1, removalListings: 1 });
});

test("an ACTIVE label without external evidence does not count as a live online listing", () => {
  const summary = summarizeSellingStock([{ status: "LISTED", grade: "RAW", condition: "NM", listings: [{ state: "ACTIVE", channel: "EBAY", listPrice: 1500 }] }]);
  assert.equal(summary.liveRows, 0);
  assert.equal(summary.preparedDrafts, 0);
});

test("daily mission puts external removal, prepared drafts and stock work before research", () => {
  const stock = { totalRows: 5, availableRows: 5, heldRows: 0, preparationRows: 2, preparedDrafts: 1, liveRows: 2, removalListings: 1 };
  assert.equal(buildSellingMission(stock, 1).target, "listings");
  assert.equal(buildSellingMission({ ...stock, removalListings: 0 }, 1).target, "drafts");
  assert.equal(buildSellingMission({ ...stock, removalListings: 0, preparedDrafts: 0 }, 1).target, "stock");
  assert.equal(buildSellingMission({ ...stock, removalListings: 0, preparedDrafts: 0, preparationRows: 0 }, 1).title, "Work your live listings");
  assert.equal(buildSellingMission(summarizeSellingStock([]), 2).target, "profit");
});

test("pending full or partial sales remain in raw stock totals but never become a prepared publishing mission", () => {
  const card = { status: "IN_STOCK", grade: "RAW", condition: "NM", quantity: 2, photos: [{ url: "https://example.test/front.jpg", origin: "REAL" as const }], listings: [{ state: "DRAFT", channel: "EBAY", listPrice: 2500 }] };
  for (const localAvailableQuantity of [0, null, 1]) {
    const summary = summarizeSellingStock([{ ...card, localAvailableQuantity }]);
    assert.equal(summary.totalRows, 1);
    assert.equal(summary.availableRows, 0);
    assert.equal(summary.heldRows, 1);
    assert.equal(summary.preparedDrafts, 0);
    assert.equal(summary.preparationRows, 0);
    assert.equal(summary.liveRows, 0);
    assert.equal(summary.removalListings, 0);
    assert.equal(buildSellingMission(summary, 0).title, "Review your held stock");
    assert.equal(buildSellingMission(summary, 0).target, "stock");
    const plan = buildLaunchPlan({ stockCount: 1, sellableStockCount: summary.availableRows, draftListings: 1, activeListings: 1,
      preparedDrafts: summary.preparedDrafts, soldCount: 0, activeWatches: 0, operatingExpensePence: 0,
      secondaryCrossCheck: false, alertDelivery: false });
    assert.equal(plan.some((step) => ["first-listings", "activate-drafts", "first-sale"].includes(step.id)), false);
  }
  const synced = summarizeSellingStock([{ ...card, quantity: 1, localAvailableQuantity: 1 }]);
  assert.equal(synced.totalRows, 1);
  assert.equal(synced.preparedDrafts, 1);
  assert.equal(buildSellingMission(synced, 0).target, "drafts");
});
