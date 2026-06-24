import { test } from "node:test";
import assert from "node:assert/strict";
import { listingVenueAction, nextDraftListingId } from "./listingWorkflow.js";

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

test("listingVenueAction gives an official UK eBay listing entrypoint only for eBay", () => {
  assert.deepEqual(listingVenueAction("EBAY"), {
    label: "Open eBay Sell",
    url: "https://www.ebay.co.uk/sl/sell",
  });
  assert.equal(listingVenueAction("VINTED"), null);
  assert.equal(listingVenueAction("CARDMARKET"), null);
  assert.equal(listingVenueAction("IN_PERSON"), null);
});
