import assert from "node:assert/strict";
import test from "node:test";

import { buildTodayActions } from "./today.js";

test("buildTodayActions starts a new seller with opening stock, first buy and buy target actions", () => {
  const actions = buildTodayActions({
    stockCount: 0,
    activeStockCount: 0,
    soldCount: 0,
    draftListings: 0,
    activeListings: 0,
    activeWatches: 0,
    agedStockCount: 0,
    unlistedStockCount: 0,
    operatingExpensePence: 0,
  });

  assert.deepEqual(actions.map((action) => action.id), ["opening-stock", "first-buy", "log-first-cost", "buy-target"]);
  assert.equal(actions[0]?.target, "opening-stock");
  assert.equal(actions[1]?.target, "buy");
  assert.equal(actions[2]?.target, "profit");
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
    operatingExpensePence: 1000,
  });

  assert.deepEqual(actions.map((action) => action.id), [
    "draft-listings",
    "unlisted-stock",
    "active-sales",
    "reprice",
    "aged-stock",
  ]);
  assert.equal(actions.find((action) => action.id === "unlisted-stock")?.target, "drafts");
  assert.equal(actions.find((action) => action.id === "active-sales")?.target, "sales");
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
      operatingExpensePence: 0,
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
    operatingExpensePence: 500,
  });

  assert.equal(actions.some((action) => action.id === "reprice"), false);
  assert.equal(actions[0]?.id, "draft-listings");
});

test("buildTodayActions sends first-sale work to active listings when possible", () => {
  const actions = buildTodayActions({
    stockCount: 2,
    activeStockCount: 2,
    soldCount: 0,
    draftListings: 0,
    activeListings: 1,
    activeWatches: 1,
    agedStockCount: 0,
    unlistedStockCount: 0,
    operatingExpensePence: 500,
  });

  const firstSale = actions.find((action) => action.id === "first-sale");
  assert.equal(firstSale?.target, "sales");
  assert.match(firstSale?.detail ?? "", /active listings/);
});

test("buildTodayActions keeps booking active sales visible after first sale", () => {
  const actions = buildTodayActions({
    stockCount: 6,
    activeStockCount: 4,
    soldCount: 3,
    draftListings: 0,
    activeListings: 2,
    activeWatches: 1,
    agedStockCount: 0,
    unlistedStockCount: 0,
    operatingExpensePence: 500,
  });

  const activeSales = actions.find((action) => action.id === "active-sales");
  assert.equal(activeSales?.target, "sales");
  assert.equal(activeSales?.tone, "good");
  assert.match(activeSales?.detail ?? "", /2 active listings/);
});

test("buildTodayActions keeps fast comping available after setup", () => {
  const actions = buildTodayActions({
    stockCount: 12,
    activeStockCount: 8,
    soldCount: 5,
    draftListings: 0,
    activeListings: 0,
    activeWatches: 1,
    agedStockCount: 0,
    unlistedStockCount: 0,
    operatingExpensePence: 500,
  });

  const nextBuy = actions.find((action) => action.id === "comp-next-buy");
  assert.equal(nextBuy?.target, "buy");
  assert.match(nextBuy?.detail ?? "", /Fast lookup/);
});

test("buildTodayActions keeps setup costs visible until the first cost is logged", () => {
  const actions = buildTodayActions({
    stockCount: 3,
    activeStockCount: 3,
    soldCount: 0,
    draftListings: 0,
    activeListings: 0,
    activeWatches: 1,
    agedStockCount: 0,
    unlistedStockCount: 0,
    operatingExpensePence: 0,
  });

  const costAction = actions.find((action) => action.id === "log-first-cost");
  assert.equal(costAction?.target, "profit");
  assert.equal(costAction?.title, "Log first cost");
});
