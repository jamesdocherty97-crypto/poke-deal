import assert from "node:assert/strict";
import test from "node:test";
import { PATCH } from "../../app/api/listings/[id]/route.js";
import { planListingEnd } from "./listingEnd.js";

const liveUrl = "https://www.ebay.co.uk/itm/123456789012";
const prepared = {
  id: "listing-1", itemId: "item-1", channel: "EBAY", state: "DRAFT",
  title: "Pikachu", titleCustomized: false, listPrice: 2500,
  externalRef: "offer:prepared-A", externalUrl: null, ebayOfferId: "prepared-A",
  offerSyncedAt: new Date("2026-09-01T12:00:00Z"), offerSyncedPrice: 2500,
  listedAt: null, endedAt: null, item: { status: "IN_STOCK" },
};

async function patchWithDb(existing: Record<string, unknown>, body: unknown) {
  const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globalDb.prisma;
  const previousFetch = globalThis.fetch;
  let saved: Record<string, unknown> | undefined;
  let providerCalls = 0;
  const db = {
    async $transaction(fn: (tx: unknown) => unknown) { return fn(db); },
    listing: {
      async findUnique() { return existing; },
      async update({ data }: { data: Record<string, unknown> }) { saved = data; return { ...existing, ...data }; },
    },
    inventoryItem: { async update() { return { status: "LISTED" }; } },
  };
  globalDb.prisma = db;
  globalThis.fetch = async () => { providerCalls++; throw new Error("Provider access is forbidden in this test"); };
  try {
    const response = await PATCH(new Request("http://localhost/api/listings/listing-1", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: "listing-1" }) });
    return { response, payload: await response.json(), saved, providerCalls };
  } finally {
    globalDb.prisma = previousDb;
    globalThis.fetch = previousFetch;
  }
}

test("adopting a manual live item clears the prepared offer and requires manual removal", async () => {
  const result = await patchWithDb(prepared, { state: "ACTIVE", externalUrl: liveUrl });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.saved?.externalRef, "123456789012");
  assert.equal(result.saved?.ebayOfferId, null);
  assert.equal(result.saved?.offerSyncedAt, null);
  assert.equal(result.saved?.offerSyncedPrice, null);
  assert.equal(planListingEnd(result.payload.listing), "confirm-removal");
  assert.equal(result.providerCalls, 0);
});

test("manual live price edits cannot rediscover and update an old offer by SKU", async () => {
  const result = await patchWithDb({ ...prepared, state: "ACTIVE", externalRef: "123456789012", externalUrl: liveUrl, ebayOfferId: null }, { listPricePence: 2900 });
  assert.equal(result.response.status, 409);
  assert.match(result.payload.error, /tracked manually.*edit it on eBay/);
  assert.equal(result.saved, undefined);
  assert.equal(result.providerCalls, 0);
});

test("editing an ended connected listing without changing its item preserves its offer", async () => {
  const result = await patchWithDb({ ...prepared, state: "ENDED", externalRef: "123456789012", externalUrl: liveUrl }, {
    state: "ENDED", channel: "EBAY", externalUrl: liveUrl, listPricePence: 2800,
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.saved?.ebayOfferId, undefined);
  assert.equal(result.payload.listing.ebayOfferId, "prepared-A");
  assert.equal(result.saved?.offerSyncedPrice, null);
  assert.equal(result.providerCalls, 0);
});

test("changing the saved live item of an ended listing discards its old offer association", async () => {
  const result = await patchWithDb({ ...prepared, state: "ENDED", externalRef: "987654321098", externalUrl: "https://www.ebay.co.uk/itm/987654321098" }, { externalUrl: liveUrl });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.saved?.ebayOfferId, null);
  assert.equal(result.providerCalls, 0);
});
