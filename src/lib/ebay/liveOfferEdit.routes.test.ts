import assert from "node:assert/strict";
import test from "node:test";
import { PATCH } from "../../app/api/listings/[id]/route.js";
import { clearTokenCache } from "./tokens.js";

const savedListing = {
  id: "listing-1", itemId: "item-1", channel: "EBAY", state: "ACTIVE",
  title: "Saved title", titleCustomized: true, description: null, listPrice: 2500,
  ebayOfferId: "offer-1", externalRef: "123456789012", externalUrl: "https://www.ebay.co.uk/itm/123456789012",
  item: { status: "LISTED", quantity: 1, grade: "RAW", condition: null, photos: [], card: { name: "Pikachu", language: "EN" } },
};
const remoteOffer = {
  offerId: "offer-1", sku: "pdos-item-1", marketplaceId: "EBAY_GB", format: "FIXED_PRICE", status: "PUBLISHED",
  listing: { listingId: "123456789012", listingStatus: "ACTIVE" }, availableQuantity: 1,
  listingDescription: "Current eBay condition notes", listingPolicies: { fulfillmentPolicyId: "existing-policy" },
  pricingSummary: { price: { value: "28.00", currency: "GBP" } },
};
const remoteInventory = {
  sku: "pdos-item-1", product: { title: "Current eBay title", description: "Fallback copy", imageUrls: ["https://example.test/card.jpg"] },
  availability: { shipToLocationAvailability: { quantity: 1 } }, condition: "USED_VERY_GOOD",
};

async function patchLive(body: unknown, options: {
  listing?: typeof savedListing | Record<string, unknown>;
  failPath?: string;
  failLocalSave?: boolean;
  soldDuringWrite?: boolean;
  offer?: Record<string, unknown>;
} = {}) {
  const globals = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globals.prisma;
  const previousFetch = globalThis.fetch;
  const syntheticEnv = { EBAY_CLIENT_ID: "fixture-client", EBAY_CLIENT_SECRET: "fixture-secret", EBAY_RU_NAME: "fixture-runame", EBAY_ENV: "sandbox", EBAY_MARKETPLACE_ID: "EBAY_GB", EBAY_REFRESH_TOKEN: "fixture-refresh" };
  const previousEnv = Object.fromEntries(Object.keys(syntheticEnv).map((key) => [key, process.env[key]]));
  let current: Record<string, unknown> = options.listing ?? savedListing;
  const operations: string[] = [];
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let saved: Record<string, unknown> | undefined;
  const db = {
    ebayCredential: { async findUnique() { return null; } },
    listing: {
      async findUnique() { return current; },
      async update({ data }: { data: Record<string, unknown> }) {
        operations.push("local-save");
        if (options.failLocalSave) throw new Error("Synthetic local save failure");
        saved = data;
        return { ...current, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) };
      },
    },
    async $transaction(fn: (tx: unknown) => unknown) { return fn(db); },
  };
  globals.prisma = db;
  Object.assign(process.env, syntheticEnv);
  clearTokenCache();
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    assert.equal(new URL(String(input)).hostname, "api.sandbox.ebay.com");
    if (path.endsWith("oauth2/token")) return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    if (!init?.method || init.method === "GET") return Response.json(path.includes("inventory_item/") ? remoteInventory : options.offer ?? remoteOffer);
    operations.push(`remote:${path}`);
    writes.push({ path, body: JSON.parse(String(init.body)) });
    if (options.soldDuringWrite) current = { ...current, item: { ...savedListing.item, status: "SOLD", quantity: 0 } };
    if (path === options.failPath) return Response.json({ errors: [{ errorId: 25001, message: "Synthetic rejection" }] }, { status: 400 });
    if (path.endsWith("bulk_update_price_quantity")) return Response.json({ responses: [{ offerId: "offer-1", statusCode: 200 }] });
    return new Response(null, { status: 204 });
  };
  try {
    const response = await PATCH(new Request("http://localhost/api/listings/listing-1", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: "listing-1" }) });
    return { response, payload: await response.json(), operations, writes, saved };
  } finally {
    globals.prisma = previousDb;
    globalThis.fetch = previousFetch;
    clearTokenCache();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("description-only live PATCH updates buyer copy before local save and refreshes stale saved fields", async () => {
  const result = await patchLive({ description: "Reviewed light whitening" });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.deepEqual(result.operations, ["remote:/sell/inventory/v1/offer/offer-1", "local-save"]);
  assert.equal(result.writes[0]!.body.listingDescription, "Reviewed light whitening");
  assert.equal(result.saved?.description, "Reviewed light whitening");
  assert.equal(result.saved?.title, "Current eBay title");
  assert.equal(result.saved?.listPrice, 2800);
  assert.equal(result.saved?.offerSyncedPrice, 2800);
  assert.deepEqual(result.payload.remoteUpdate, { status: "confirmed", fields: ["description"] });
});

test("live price change uses the explicit request even if it matches a stale saved price", async () => {
  const result = await patchLive({ listPricePence: 2500 });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.writes[0]!.path, "/sell/inventory/v1/bulk_update_price_quantity");
  assert.equal(result.saved?.listPrice, 2500);
  assert.deepEqual(result.payload.remoteUpdate, { status: "confirmed", fields: ["price"] });
});

test("title and description edits use verified remote GBP price when saved price is missing", async () => {
  for (const body of [{ description: "A description without a price edit" }, { title: "A reviewed title", titleCustomized: true }]) {
    const result = await patchLive(body, { listing: { ...savedListing, listPrice: null } });
    assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    assert.equal(result.saved?.listPrice, 2800);
    assert.equal(result.writes.length, 1);
  }
});

test("live edit provider rejection does not save local buyer-facing values", async () => {
  const result = await patchLive({ description: "Rejected description" }, { failPath: "/sell/inventory/v1/offer/offer-1" });
  assert.equal(result.response.status, 502);
  assert.equal(result.saved, undefined);
  assert.deepEqual(result.payload.remoteUpdate, { status: "unconfirmed", confirmedFields: [], attemptedFields: ["description"] });
});

test("live edit mixed failure and local-save failure disclose accepted remote changes", async () => {
  const partial = await patchLive({ title: "New title", description: "New notes" }, { failPath: "/sell/inventory/v1/offer/offer-1" });
  assert.equal(partial.response.status, 502);
  assert.equal(partial.saved, undefined);
  assert.deepEqual(partial.payload.remoteUpdate, { status: "partial", confirmedFields: ["title"], attemptedFields: ["description"] });
  const localFailure = await patchLive({ description: "Accepted notes" }, { failLocalSave: true });
  assert.equal(localFailure.response.status, 502);
  assert.match(localFailure.payload.error, /eBay accepted.*app could not save/);
  assert.equal(localFailure.payload.remoteUpdate.localSaved, false);
});

test("live edits cannot overwrite sold stock or reassociate a different offer", async () => {
  const sold = await patchLive({ listPricePence: 2900 }, { listing: { ...savedListing, item: { ...savedListing.item, status: "SOLD", quantity: 0 } } });
  assert.equal(sold.response.status, 409);
  assert.equal(sold.writes.length, 0);
  const mismatch = await patchLive({ listPricePence: 2900 }, { offer: { ...remoteOffer, listing: { listingId: "987654321098", listingStatus: "ACTIVE" } } });
  assert.equal(mismatch.response.status, 409);
  assert.equal(mismatch.writes.length, 0);
  const soldDuring = await patchLive({ listPricePence: 2900 }, { soldDuringWrite: true });
  assert.equal(soldDuring.response.status, 502);
  assert.equal(soldDuring.saved, undefined);
  assert.equal(soldDuring.payload.remoteUpdate.localSaved, false);
});

test("live editable fields are bounded and cannot clear price or unreviewed description", async () => {
  for (const body of [{ title: "x".repeat(81) }, { title: null }, { title: " " }, { description: "x".repeat(50_001) }, { description: null }, { description: " " }, { listPricePence: null }, { listPricePence: 98 }, { listPricePence: 2_147_483_648 }]) {
    const result = await patchLive(body);
    assert.equal(result.response.status, 400, JSON.stringify(result.payload));
    assert.equal(result.writes.length, 0);
    assert.equal(result.saved, undefined);
  }
  const oversized = await patchLive({ description: "x".repeat(300_000) });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.writes.length, 0);
});

test("drafts keep generated-description fallback and non-eBay titles retain their 200-character limit", async () => {
  const draft = { ...savedListing, channel: "VINTED", state: "DRAFT" };
  const valid = await patchLive({ title: "x".repeat(200), description: " " }, { listing: draft });
  assert.equal(valid.response.status, 200, JSON.stringify(valid.payload));
  assert.equal(valid.saved?.title, "x".repeat(200));
  assert.equal(valid.saved?.description, null);
  assert.equal(valid.writes.length, 0);
  const invalid = await patchLive({ title: "x".repeat(201) }, { listing: draft });
  assert.equal(invalid.response.status, 400);
});
