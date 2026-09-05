import assert from "node:assert/strict";
import test from "node:test";
import { activeListingEditError, planListingEnd } from "./listingEnd.js";
import { withdrawEbayOffer } from "../ebay/offer.js";
import type { EbayConfig } from "../ebay/config.js";

test("live online listings require withdrawal or an explicit removal confirmation", () => {
  assert.equal(planListingEnd({ channel: "EBAY", state: "ACTIVE", ebayOfferId: "offer-1" }), "withdraw-ebay");
  for (const channel of ["EBAY", "VINTED", "CARDMARKET"]) {
    assert.equal(planListingEnd({ channel, state: "ACTIVE" }), "confirm-removal");
    assert.equal(planListingEnd({ channel, state: "ACTIVE", externalRemovalConfirmed: true }), "local");
  }
  assert.equal(planListingEnd({ channel: "IN_PERSON", state: "ACTIVE" }), "local");
});

test("a live external listing cannot be hidden by changing its channel, URL or draft state", () => {
  const current = { state: "ACTIVE", channel: "EBAY", externalUrl: "https://www.ebay.co.uk/itm/123" };
  assert.match(activeListingEditError(current, { state: "DRAFT" })!, /End the live listing/);
  assert.match(activeListingEditError(current, { channel: "IN_PERSON" })!, /End the live listing/);
  assert.match(activeListingEditError(current, { externalUrl: null })!, /End the live listing/);
  assert.equal(activeListingEditError(current, { state: "ENDED" }), null);
});

test("eBay withdrawal uses the exact offer and refuses failed remote responses", async () => {
  const config = { apiBaseUrl: "https://api.example.test", contentLanguage: "en-GB" } as EbayConfig;
  await withdrawEbayOffer(config, "offer/123", "test-token", (async (url, options) => {
    assert.equal(url, "https://api.example.test/sell/inventory/v1/offer/offer%2F123/withdraw");
    assert.equal(options?.method, "POST");
    return new Response(JSON.stringify({ listingId: "123" }), { status: 200 });
  }) as typeof fetch);
  await assert.rejects(withdrawEbayOffer(config, "123", "test-token", (async () => new Response(
    JSON.stringify({ errors: [{ message: "Seller permission expired" }] }), { status: 403 },
  )) as typeof fetch), /Seller permission expired/);
});
