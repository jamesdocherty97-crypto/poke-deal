import test from "node:test";
import assert from "node:assert/strict";
import { hasLiveListing, inventoryItemMatchesFilter, stockReadiness, type StockReadinessItem } from "./stockReadiness.js";

const item: StockReadinessItem = {
  status: "IN_STOCK", grade: "RAW", condition: "NM", quantity: 1,
  listings: [{ state: "DRAFT", channel: "EBAY", listPrice: 2500 }],
  photos: [{ url: "https://example.test/front.jpg", origin: "REAL" }],
};

test("a photographed draft remains actionable and never counts as live", () => {
  assert.equal(hasLiveListing(item), false);
  assert.equal(inventoryItemMatchesFilter(item, "listed"), false);
  assert.equal(inventoryItemMatchesFilter(item, "needs-listing"), true);
  assert.equal(inventoryItemMatchesFilter(item, "needs-action"), true);
  assert.equal(stockReadiness(item).next, "Publish draft");
});

test("an ACTIVE label without an external reference still needs confirmation", () => {
  assert.equal(hasLiveListing({ listings: [{ state: "ACTIVE", channel: "EBAY", listPrice: 2500 }] }), false);
  assert.equal(hasLiveListing({ listings: [{ state: "ACTIVE", channel: "IN_PERSON", listPrice: 2500 }] }), true);
  assert.equal(hasLiveListing({ listings: [{ state: "ACTIVE", channel: "EBAY", externalRef: "offer:unpublished" }] }), false);
});

test("readiness distinguishes real photos, explicit price and raw inspection", () => {
  assert.equal(stockReadiness({ ...item, condition: null }).next, "Check condition");
  assert.equal(stockReadiness({ ...item, photos: [{ url: "https://example.test/art.jpg", origin: "CATALOG" }] }).next, "Add photos");
  assert.equal(stockReadiness({ ...item, listings: [{ state: "DRAFT", channel: "EBAY", listPrice: null }] }).next, "Set your price");
  const live = { ...item, listings: [{ state: "ACTIVE", channel: "EBAY", listPrice: 2500, externalUrl: "https://www.ebay.co.uk/itm/123456789012" }] };
  assert.equal(stockReadiness(live).needsAction, false);
  assert.equal(inventoryItemMatchesFilter(live, "listed"), true);
});

test("held and sold cards are outside the active preparation queue", () => {
  assert.equal(inventoryItemMatchesFilter({ ...item, status: "SOLD" }, "needs-action"), false);
  assert.equal(inventoryItemMatchesFilter({ ...item, status: "RESERVED" }, "needs-action"), false);
  assert.equal(inventoryItemMatchesFilter({ ...item, status: "RESERVED" }, "held"), true);
});

test("a locally reserved last copy stays visible as held, without becoming sold or publishable", () => {
  const reserved = { ...item, localAvailableQuantity: 0 };
  const readiness = stockReadiness(reserved);
  assert.equal(readiness.locallyUnavailable, true);
  assert.equal(readiness.held, true);
  assert.equal(readiness.sold, false);
  assert.equal(readiness.needsAction, true);
  assert.equal(readiness.next, "Sync sale");
  assert.equal(inventoryItemMatchesFilter(reserved, "all"), true);
  assert.equal(inventoryItemMatchesFilter(reserved, "held"), true);
  assert.equal(inventoryItemMatchesFilter(reserved, "needs-action"), true);
  for (const filter of ["needs-listing", "drafts", "listed", "needs-photos", "sold"] as const) {
    assert.equal(inventoryItemMatchesFilter(reserved, filter), false, filter);
  }
  assert.equal(reserved.status, "IN_STOCK");
});

test("unconfirmed local availability fails closed until the browser queue is checked", () => {
  const unconfirmed = stockReadiness({ ...item, localAvailableQuantity: null });
  assert.equal(unconfirmed.held, true);
  assert.equal(unconfirmed.needsAction, true);
  assert.equal(unconfirmed.next, "Check queued sales");
  assert.equal(stockReadiness({ ...item, localAvailableQuantity: Number.NaN }).held, true);
  const confirmed = { ...item, localAvailableQuantity: 1 };
  assert.equal(stockReadiness(confirmed).held, false);
  assert.equal(stockReadiness(confirmed).next, "Publish draft");
  assert.equal(inventoryItemMatchesFilter(confirmed, "drafts"), true);
});

test("a partial local sale must sync the server quantity before the row can be published", () => {
  const partial = { ...item, quantity: 2, localAvailableQuantity: 1 };
  const readiness = stockReadiness(partial);
  assert.equal(readiness.locallyUnavailable, false);
  assert.equal(readiness.localSalePending, true);
  assert.equal(readiness.held, true);
  assert.equal(readiness.needsAction, true);
  assert.equal(readiness.next, "Sync sale");
  assert.equal(inventoryItemMatchesFilter(partial, "all"), true);
  assert.equal(inventoryItemMatchesFilter(partial, "held"), true);
  assert.equal(inventoryItemMatchesFilter(partial, "needs-action"), true);
  assert.equal(inventoryItemMatchesFilter(partial, "drafts"), false);
  assert.equal(stockReadiness({ ...partial, quantity: 1 }).held, false);
});

test("a local hold preserves evidence of an external live listing without offering it as sellable stock", () => {
  const pending = { ...item, localAvailableQuantity: 0, listings: [{ state: "ACTIVE", channel: "EBAY", listPrice: 2500, externalUrl: "https://www.ebay.co.uk/itm/123456789012" }] };
  assert.equal(hasLiveListing(pending), true);
  assert.equal(inventoryItemMatchesFilter(pending, "listed"), false);
  assert.equal(inventoryItemMatchesFilter(pending, "held"), true);
  assert.equal(stockReadiness({ ...pending, status: "SOLD" }).held, false);
  assert.equal(inventoryItemMatchesFilter({ ...pending, status: "SOLD" }, "sold"), true);
});
