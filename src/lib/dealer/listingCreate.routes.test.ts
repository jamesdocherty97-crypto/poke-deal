import test from "node:test";
import assert from "node:assert/strict";
import { PATCH } from "../../app/api/listings/[id]/route.js";
import { POST } from "../../app/api/listings/route.js";

const input = { itemId: "item-1", channel: "VINTED", state: "DRAFT", listPricePence: 2500 };
function request(body: unknown = input, id = "import:batch-test:0:draft") {
  return new Request("http://localhost/api/listings", { method: "POST", headers: { "content-type": "application/json", "x-poke-deal-mutation-id": id }, body: JSON.stringify(body) });
}
async function withDb(db: unknown, run: () => Promise<void>) {
  const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
  const previous = globalDb.prisma;
  globalDb.prisma = db;
  try { await run(); } finally { globalDb.prisma = previous; }
}

test("retry after a lost draft response returns the original listing", async () => {
  let saved: Record<string, unknown> | null = null;
  let writes = 0;
  const db = {
    async $transaction(fn: (tx: unknown) => unknown) { return fn(db); },
    inventoryItem: { async findUnique() { return { id: "item-1", status: "IN_STOCK", grade: "RAW", condition: "LP", card: { name: "Gengar" } }; } },
    listing: {
      async findUnique() { return saved; },
      async create({ data }: { data: Record<string, unknown> }) { writes++; saved = { id: "listing-1", ...data }; return saved; },
    },
  };
  await withDb(db, async () => {
    assert.equal((await POST(request())).status, 201);
    const retry = await POST(request());
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).listing.id, "listing-1");
    assert.equal(writes, 1);
    const mismatch = await POST(request({ ...input, itemId: "item-2" }));
    assert.equal(mismatch.status, 409);
  });
});

test("a concurrent unique-key conflict recovers the winning draft", async () => {
  let saved: Record<string, unknown> | null = null;
  const db = {
    async $transaction(fn: (tx: unknown) => unknown) { return fn(db); },
    inventoryItem: { async findUnique() { return { id: "item-1", status: "IN_STOCK", grade: "RAW", condition: "DMG", card: { name: "Pikachu" } }; } },
    listing: {
      async findUnique() { return saved; },
      async create({ data }: { data: Record<string, unknown> }) { saved = { id: "concurrent-winner", ...data }; throw new Error("Unique key conflict"); },
    },
  };
  await withDb(db, async () => {
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).listing.id, "concurrent-winner");
  });
});

test("invalid import identifiers and oversized bodies fail before database access", async () => {
  await withDb({}, async () => {
    assert.equal((await POST(request(input, "bad"))).status, 400);
    assert.equal((await POST(request({ ...input, extra: "x".repeat(17_000) }))).status, 413);
  });
});

test("pasting a genuine eBay item link activates a manual draft without a provider write", async () => {
  const existing = { id: "listing-1", itemId: "item-1", channel: "EBAY", state: "DRAFT", title: "Pikachu", titleCustomized: false, listPrice: 2500, externalRef: null, externalUrl: null, listedAt: null, item: { status: "IN_STOCK" } };
  let saved: Record<string, unknown> | undefined;
  const db = {
    async $transaction(fn: (tx: unknown) => unknown) { return fn(db); },
    listing: {
      async findUnique() { return existing; },
      async update({ data }: { data: Record<string, unknown> }) { saved = data; return { ...existing, ...data }; },
    },
    inventoryItem: { async update() { return { status: "LISTED" }; } },
  };
  await withDb(db, async () => {
    const response = await PATCH(new Request("http://localhost/api/listings/listing-1", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "ACTIVE", externalUrl: "https://www.ebay.co.uk/itm/123456789012" }),
    }), { params: Promise.resolve({ id: "listing-1" }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal(saved?.externalRef, "123456789012");
    assert.equal(saved?.state, "ACTIVE");
  });
});
