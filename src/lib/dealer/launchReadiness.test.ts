import assert from "node:assert/strict";
import test from "node:test";

import { buildLaunchReadiness } from "./launchReadiness.js";

test("buildLaunchReadiness starts with source and first-buy setup work", () => {
  const items = buildLaunchReadiness({
    livePrimaryComps: false,
    liveCatalogKey: false,
    secondaryCrossCheck: false,
    alertDelivery: false,
    stockCount: 0,
    draftListings: 0,
    activeListings: 0,
    soldCount: 0,
    activeWatches: 0,
    operatingExpensePence: 0,
  });

  assert.equal(items[0]?.id, "live-comps");
  assert.equal(items[0]?.state, "warn");
  assert.equal(items.some((item) => item.id === "first-buy" && item.target === "buy"), true);
  assert.equal(items.some((item) => item.id === "cross-check" && item.state === "warn"), true);
  assert.equal(items.find((item) => item.id === "alerts")?.state, "next");
});

test("buildLaunchReadiness nudges draft listings and first sale for a new operator", () => {
  const items = buildLaunchReadiness({
    livePrimaryComps: true,
    liveCatalogKey: true,
    secondaryCrossCheck: false,
    alertDelivery: false,
    stockCount: 3,
    draftListings: 2,
    activeListings: 0,
    soldCount: 0,
    activeWatches: 0,
    operatingExpensePence: 0,
  });

  const listing = items.find((item) => item.id === "listing-pipeline");
  const sale = items.find((item) => item.id === "sale-loop");

  assert.equal(listing?.state, "next");
  assert.equal(listing?.target, "listings");
  assert.match(listing?.detail ?? "", /2 draft/);
  assert.equal(sale?.target, "stock");
  assert.equal(items.some((item) => item.id === "first-buy"), false);
});

test("buildLaunchReadiness routes unlisted stock to the listing desk", () => {
  const items = buildLaunchReadiness({
    livePrimaryComps: true,
    liveCatalogKey: true,
    secondaryCrossCheck: true,
    alertDelivery: false,
    stockCount: 3,
    draftListings: 0,
    activeListings: 0,
    soldCount: 0,
    activeWatches: 0,
    operatingExpensePence: 0,
  });

  const listing = items.find((item) => item.id === "listing-pipeline");

  assert.equal(listing?.state, "next");
  assert.equal(listing?.action, "List");
  assert.equal(listing?.target, "listings");
});

test("buildLaunchReadiness marks operating systems done when they are ready", () => {
  const items = buildLaunchReadiness({
    livePrimaryComps: true,
    liveCatalogKey: true,
    secondaryCrossCheck: true,
    ebayConfigured: true,
    ebayConnected: true,
    ebayHasPolicies: true,
    ebayHasMerchantLocation: true,
    alertDelivery: true,
    stockCount: 6,
    draftListings: 0,
    activeListings: 4,
    soldCount: 2,
    activeWatches: 1,
    operatingExpensePence: 2500,
  });

  assert.equal(items.find((item) => item.id === "live-comps")?.state, "done");
  assert.equal(items.find((item) => item.id === "cross-check")?.state, "done");
  assert.equal(items.find((item) => item.id === "ebay-automation")?.state, "done");
  assert.equal(items.find((item) => item.id === "alerts")?.state, "done");
  assert.equal(items.find((item) => item.id === "listing-pipeline")?.state, "done");
  assert.equal(items.find((item) => item.id === "sale-loop")?.state, "done");
});

test("buildLaunchReadiness keeps eBay offer creation blocked until seller location is ready", () => {
  const items = buildLaunchReadiness({
    livePrimaryComps: true,
    liveCatalogKey: true,
    secondaryCrossCheck: true,
    ebayConfigured: true,
    ebayConnected: true,
    ebayHasPolicies: true,
    ebayHasMerchantLocation: false,
    alertDelivery: false,
    stockCount: 2,
    draftListings: 2,
    activeListings: 0,
    soldCount: 0,
    activeWatches: 0,
    operatingExpensePence: 0,
  });

  const ebay = items.find((item) => item.id === "ebay-automation");
  const alerts = items.find((item) => item.id === "alerts");

  assert.equal(ebay?.state, "warn");
  assert.equal(ebay?.target, "listings");
  assert.match(ebay?.detail ?? "", /seller location/);
  assert.equal(alerts?.state, "next");
});

test("buildLaunchReadiness flags eBay policy setup after account connection", () => {
  const items = buildLaunchReadiness({
    livePrimaryComps: true,
    liveCatalogKey: true,
    secondaryCrossCheck: true,
    ebayConfigured: true,
    ebayConnected: true,
    ebayHasPolicies: false,
    alertDelivery: false,
    stockCount: 1,
    draftListings: 1,
    activeListings: 0,
    soldCount: 0,
    activeWatches: 0,
    operatingExpensePence: 0,
  });

  const ebay = items.find((item) => item.id === "ebay-automation");

  assert.equal(ebay?.state, "warn");
  assert.match(ebay?.detail ?? "", /payment, postage and return policies/);
});
