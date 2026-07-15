import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildListingNextAction,
  buildListingSellFlow,
  listingVenueAction,
  nextDraftListingId,
  nextSaleListingId,
} from "./listingWorkflow.js";

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

test("listingVenueAction gives marketplace handoff entrypoints", () => {
  assert.deepEqual(listingVenueAction("EBAY"), {
    label: "Open eBay Sell",
    url: "https://www.ebay.co.uk/sl/sell",
    openedLabel: "eBay Sell",
  });

  assert.deepEqual(listingVenueAction("VINTED"), {
    label: "Open Vinted",
    url: "https://www.vinted.co.uk/items/new",
    openedLabel: "Vinted upload",
  });

  assert.deepEqual(listingVenueAction("CARDMARKET", { query: "Gengar TG06 Lost Origin Trainer Gallery" }), {
    label: "Open Cardmarket",
    url: "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Gengar+TG06+Lost+Origin+Trainer+Gallery",
    openedLabel: "Cardmarket",
  });

  assert.equal(listingVenueAction("IN_PERSON"), null);
});

test("buildListingSellFlow keeps eBay review and publish in one continuous path", () => {
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
  assert.equal(offer.find((step) => step.id === "publish")?.state, "next");

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

test("buildListingSellFlow blocks eBay publish until readiness passes", () => {
  const flow = buildListingSellFlow({
    channel: "EBAY",
    state: "DRAFT",
    externalRef: null,
    ebayReady: false,
    sellable: true,
  });

  assert.equal(flow.find((step) => step.id === "review")?.state, "blocked");
  assert.equal(flow.find((step) => step.id === "publish")?.state, "blocked");
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

test("buildListingNextAction falls back to manual eBay listing when automation is not ready", () => {
  const action = buildListingNextAction({
    channel: "EBAY",
    state: "DRAFT",
    externalRef: null,
    ebayReady: false,
    sellable: true,
    hasVenueAction: true,
  });

  assert.equal(action.id, "copy-open");
  assert.equal(action.cta, "Copy + open");
  assert.match(action.detail, /automation is unavailable/);
});

test("buildListingNextAction prompts for a live URL after a manual copy", () => {
  const action = buildListingNextAction({
    channel: "EBAY",
    state: "DRAFT",
    externalRef: null,
    ebayReady: false,
    sellable: true,
    hasVenueAction: true,
    packCopied: true,
  });

  assert.equal(action.id, "paste-url");
  assert.equal(action.cta, "Paste URL");
});

test("buildListingNextAction walks eBay automation from review-and-publish to sale", () => {
  assert.equal(
    buildListingNextAction({
      channel: "EBAY",
      state: "DRAFT",
      externalRef: null,
      ebayReady: true,
      sellable: true,
    }).id,
    "publish",
  );
  assert.equal(
    buildListingNextAction({
      channel: "EBAY",
      state: "DRAFT",
      externalRef: "offer:abc",
      ebayReady: true,
      sellable: true,
    }).id,
    "publish",
  );
  assert.equal(
    buildListingNextAction({
      channel: "EBAY",
      state: "ACTIVE",
      externalRef: "1234567890",
      ebayReady: true,
      sellable: true,
    }).id,
    "record-sale",
  );
});

test("buildListingNextAction guides manual marketplace listings", () => {
  assert.equal(
    buildListingNextAction({
      channel: "VINTED",
      state: "DRAFT",
      sellable: true,
      hasVenueAction: true,
    }).id,
    "copy-open",
  );
  assert.equal(
    buildListingNextAction({
      channel: "CARDMARKET",
      state: "DRAFT",
      externalUrl: "https://example.com/listing",
      sellable: true,
      hasVenueAction: true,
    }).id,
    "activate",
  );
  assert.equal(
    buildListingNextAction({
      channel: "VINTED",
      state: "DRAFT",
      sellable: true,
      hasVenueAction: true,
      packCopied: true,
    }).id,
    "paste-url",
  );
  assert.equal(
    buildListingNextAction({
      channel: "IN_PERSON",
      state: "DRAFT",
      sellable: true,
      hasVenueAction: false,
    }).id,
    "copy-only",
  );
});
