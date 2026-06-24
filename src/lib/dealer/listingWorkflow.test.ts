import { test } from "node:test";
import assert from "node:assert/strict";
import { buildListingSellFlow, listingVenueAction, nextDraftListingId, nextSaleListingId } from "./listingWorkflow.js";

test("nextDraftListingId advances through stocked draft listings", () => {
  const listings = [
    { id: "active", state: "ACTIVE", item: {} },
    { id: "draft-a", state: "DRAFT", item: {} },
    { id: "draft-missing-item", state: "DRAFT", item: null },
    { id: "draft-b", state: "DRAFT", item: {} },
  ];

  assert.equal(nextDraftListingId(listings, undefined), "draft-a");
  assert.equal(nextDraftListingId(listings, "draft-a"), "draft-b");
  assert.equal(nextDraftListingId(listings, "draft-b"), "draft-a");
  assert.equal(nextDraftListingId(listings, "unknown"), "draft-a");
  assert.equal(nextDraftListingId([{ id: "only", state: "DRAFT", item: {} }], "only"), null);
});

test("nextSaleListingId advances through active sellable listings", () => {
  const listings = [
    { id: "draft", state: "DRAFT", item: {} },
    { id: "active-a", state: "ACTIVE", item: { status: "LISTED" } },
    { id: "active-sold", state: "ACTIVE", item: { status: "SOLD" } },
    { id: "active-missing-item", state: "ACTIVE", item: null },
    { id: "active-b", state: "ACTIVE", item: { status: "IN_STOCK" } },
  ];

  assert.equal(nextSaleListingId(listings, undefined), "active-a");
  assert.equal(nextSaleListingId(listings, "active-a"), "active-b");
  assert.equal(nextSaleListingId(listings, "active-b"), "active-a");
  assert.equal(nextSaleListingId(listings, "unknown"), "active-a");
  assert.equal(nextSaleListingId([{ id: "only", state: "ACTIVE", item: {} }], "only"), null);
});

test("listingVenueAction gives an official UK eBay listing entrypoint only for eBay", () => {
  assert.deepEqual(listingVenueAction("EBAY"), {
    label: "Open eBay Sell",
    url: "https://www.ebay.co.uk/sl/sell",
  });
  assert.equal(listingVenueAction("VINTED"), null);
  assert.equal(listingVenueAction("CARDMARKET"), null);
  assert.equal(listingVenueAction("IN_PERSON"), null);
});

test("buildListingSellFlow walks eBay drafts through review, offer, publish and sale", () => {
  const draft = buildListingSellFlow({
    channel: "EBAY",
    state: "DRAFT",
    externalRef: null,
    ebayReady: true,
    sellable: true,
  });
  assert.deepEqual(
    draft.map((step) => [step.id, step.state]),
    [
      ["review", "current"],
      ["offer", "current"],
      ["publish", "next"],
      ["sale", "next"],
    ],
  );

  const offer = buildListingSellFlow({
    channel: "EBAY",
    state: "DRAFT",
    externalRef: "offer:abc123",
    ebayReady: true,
    sellable: true,
  });
  assert.equal(offer.find((step) => step.id === "offer")?.state, "done");
  assert.equal(offer.find((step) => step.id === "publish")?.state, "current");

  const live = buildListingSellFlow({
    channel: "EBAY",
    state: "ACTIVE",
    externalRef: "1234567890",
    ebayReady: true,
    sellable: true,
  });
  assert.equal(live.find((step) => step.id === "publish")?.state, "done");
  assert.equal(live.find((step) => step.id === "sale")?.state, "current");
});

test("buildListingSellFlow blocks eBay offer creation until readiness passes", () => {
  const flow = buildListingSellFlow({
    channel: "EBAY",
    state: "DRAFT",
    externalRef: null,
    ebayReady: false,
    sellable: true,
  });

  assert.equal(flow.find((step) => step.id === "offer")?.state, "blocked");
});

test("buildListingSellFlow keeps manual channels simple", () => {
  const draft = buildListingSellFlow({
    channel: "VINTED",
    state: "DRAFT",
    sellable: true,
  });
  assert.deepEqual(
    draft.map((step) => [step.id, step.state]),
    [
      ["copy", "current"],
      ["activate", "next"],
      ["sale", "next"],
    ],
  );

  const active = buildListingSellFlow({
    channel: "CARDMARKET",
    state: "ACTIVE",
    sellable: true,
  });
  assert.equal(active.find((step) => step.id === "activate")?.state, "done");
  assert.equal(active.find((step) => step.id === "sale")?.state, "current");
});
