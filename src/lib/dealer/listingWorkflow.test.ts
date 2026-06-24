import { test } from "node:test";
import assert from "node:assert/strict";
import { listingVenueAction, nextDraftListingId, nextSaleListingId } from "./listingWorkflow.js";

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
