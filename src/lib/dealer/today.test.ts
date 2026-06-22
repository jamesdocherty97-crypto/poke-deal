import assert from "node:assert/strict";
import test from "node:test";

import { buildTodayActions } from "./today.js";

test("buildTodayActions starts a new seller with first buy and buy target actions", () => {
  const actions = buildTodayActions({
    stockCount: 0,
    activeStockCount: 0,
    soldCount: 0,
    draftListings: 0,
    activeListings: 0,
    activeWatches: 0,
    agedStockCount: 0,
    unlistedStockCount: 0,
  });

  assert.deepEqual(actions.map((action) => action.id), ["first-buy", "buy-target"]);
  assert.equal(actions[0]?.target, "buy");
});

test("buildTodayActions prioritizes drafts and unlisted stock for an operating seller", () => {
  const actions = buildTodayActions({
    stockCount: 8,
    activeStockCount: 6,
    soldCount: 2,
    draftListings: 3,
    activeListings: 4,
    activeWatches: 1,
    agedStockCount: 2,
    unlistedStockCount: 1,
  });

  assert.deepEqual(actions.map((action) => action.id), [
    "draft-listings",
    "unlisted-stock",
    "reprice",
    "aged-stock",
  ]);
});

test("buildTodayActions caps noisy queues without dropping the highest priority actions", () => {
  const actions = buildTodayActions(
    {
      stockCount: 2,
      activeStockCount: 2,
      soldCount: 0,
      draftListings: 1,
      activeListings: 1,
      activeWatches: 0,
      agedStockCount: 1,
      unlistedStockCount: 1,
    },
    3,
  );

  assert.deepEqual(actions.map((action) => action.id), ["draft-listings", "unlisted-stock", "reprice"]);
});

test("buildTodayActions does not offer repricing until a listing is active", () => {
  const actions = buildTodayActions({
    stockCount: 1,
    activeStockCount: 1,
    soldCount: 0,
    draftListings: 1,
    activeListings: 0,
    activeWatches: 1,
    agedStockCount: 0,
    unlistedStockCount: 0,
  });

  assert.equal(actions.some((action) => action.id === "reprice"), false);
  assert.equal(actions[0]?.id, "draft-listings");
});
