import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../../app/api/listings/[id]/ebay/edit/route.js";

const listing = {
  id: "listing-1", itemId: "item-1", channel: "EBAY", state: "ACTIVE",
  ebayOfferId: "offer-1", externalRef: "123456789012",
  externalUrl: "https://www.ebay.co.uk/itm/123456789012",
  item: { status: "LISTED", quantity: 1 },
};

async function readWithListing(value: unknown) {
  const globals = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globals.prisma;
  const previousFetch = globalThis.fetch;
  let providerCalls = 0;
  globals.prisma = { listing: { async findUnique() { return value; } } };
  globalThis.fetch = async () => { providerCalls++; throw new Error("No external requests allowed"); };
  try {
    const response = await GET(new Request("http://localhost/api/listings/listing-1/ebay/edit"), {
      params: Promise.resolve({ id: "listing-1" }),
    });
    return { response, body: await response.json(), providerCalls };
  } finally {
    globals.prisma = previousDb;
    globalThis.fetch = previousFetch;
  }
}

test("live editor cannot read an unlinked or mismatched marketplace listing", async () => {
  for (const value of [
    { ...listing, ebayOfferId: null },
    { ...listing, state: "DRAFT" },
    { ...listing, channel: "VINTED" },
    { ...listing, externalUrl: "https://www.ebay.co.uk/itm/987654321098" },
  ]) {
    const result = await readWithListing(value);
    assert.equal(result.response.status, 409);
    assert.equal(result.providerCalls, 0);
    assert.match(result.response.headers.get("Cache-Control")!, /no-store/);
  }
});

test("sold stock remains a removal task instead of an editable live listing", async () => {
  for (const item of [{ status: "SOLD", quantity: 1 }, { status: "LISTED", quantity: 0 }]) {
    const result = await readWithListing({ ...listing, item });
    assert.equal(result.response.status, 409);
    assert.match(result.body.error, /Remove its live listing/);
    assert.equal(result.providerCalls, 0);
  }
});

test("missing listing does not fetch a marketplace or manufacture an editable snapshot", async () => {
  const result = await readWithListing(null);
  assert.equal(result.response.status, 404);
  assert.equal(result.providerCalls, 0);
});
