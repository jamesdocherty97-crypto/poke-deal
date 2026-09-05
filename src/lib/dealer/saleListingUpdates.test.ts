import assert from "node:assert/strict";
import test from "node:test";
import { listingStockAttention, planSaleListingUpdates } from "./saleListingUpdates.js";

const listings = [
  { id: "ebay", channel: "EBAY" as const, state: "ACTIVE" },
  { id: "vinted", channel: "VINTED" as const, state: "ACTIVE" },
  { id: "draft", channel: "CARDMARKET" as const, state: "DRAFT" },
];

test("final sale retains other live channels as explicit removal work", () => {
  assert.deepEqual(planSaleListingUpdates({ listings, soldListingId: "ebay", soldChannel: "EBAY", fullySold: true }), {
    soldListingIds: ["ebay"], endedListingIds: ["draft"], externalAttentionIds: ["vinted"],
  });
});

test("a show sale leaves every online listing visible until removal is confirmed", () => {
  assert.deepEqual(planSaleListingUpdates({ listings, soldChannel: "IN_PERSON", fullySold: true }), {
    soldListingIds: [], endedListingIds: ["draft"], externalAttentionIds: ["ebay", "vinted"],
  });
  assert.equal(listingStockAttention({ state: "ACTIVE", channel: "EBAY", item: { status: "SOLD" } }), true);
  assert.equal(listingStockAttention({ state: "ENDED", channel: "EBAY", item: { status: "SOLD" } }), false);
});

test("partial sale keeps every listing active and asks to check other venue quantities", () => {
  assert.deepEqual(planSaleListingUpdates({ listings, soldListingId: "ebay", soldChannel: "EBAY", fullySold: false }), {
    soldListingIds: [], endedListingIds: [], externalAttentionIds: ["vinted"],
  });
});

test("an ambiguous or wrong-channel listing cannot be silently marked sold", () => {
  const ambiguous = [...listings, { id: "ebay2", channel: "EBAY" as const, state: "ACTIVE" }];
  assert.deepEqual(planSaleListingUpdates({ listings: ambiguous, soldChannel: "EBAY", fullySold: true }).soldListingIds, []);
  assert.deepEqual(planSaleListingUpdates({ listings, soldListingId: "vinted", soldChannel: "EBAY", fullySold: true }).soldListingIds, []);
});
