import { test } from "node:test";
import assert from "node:assert/strict";
import { PATCH, DELETE } from "../../app/api/inventory/[id]/route.js";

const params = { params: Promise.resolve({ id: "item-1" }) };

test("deleting stock with sales stops before deleting listings, sales, stock or photos", async () => {
  const calls: string[] = [];
  const db = {
    async $transaction(fn: (tx: unknown) => unknown) { return fn(db); },
    async $queryRaw() { calls.push("lock"); return [{ id: "item-1" }]; },
    inventoryItem: {
      async findUnique() { calls.push("read"); return { _count: { sales: 2 }, listings: [], photos: [{ url: "https://fixture.public.blob.vercel-storage.com/photo.jpg" }] }; },
      async delete() { assert.fail("stock must remain"); },
    },
    sale: { async deleteMany() { assert.fail("sales must remain"); } },
    listing: { async deleteMany() { assert.fail("listings must remain"); } },
  };
  await withDb(db, async () => {
    const response = await DELETE(new Request("http://localhost/api/inventory/item-1", { method: "DELETE" }), params);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /sales cannot be deleted/);
    assert.deepEqual(calls, ["lock", "read"]);
  });
});

test("editing current inventory cost cannot rewrite the fallback basis of an older sale", async () => {
  const db = {
    async $transaction(fn: (tx: unknown) => unknown) { return fn(db); },
    async $queryRaw() { return [{ id: "item-1" }]; },
    inventoryItem: {
      async findUnique() { return { costBasis: 1000, sales: [{ costBasis: null }] }; },
      async update() { assert.fail("legacy cost must first be confirmed on the sale"); },
    },
  };
  await withDb(db, async () => {
    const response = await PATCH(new Request("http://localhost/api/inventory/item-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ costBasisPence: 2000 }) }), params);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /historical acquisition cost/);
  });
});

async function withDb(db: unknown, run: () => Promise<void>) {
  const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
  const previous = globalDb.prisma;
  globalDb.prisma = db;
  try { await run(); } finally { globalDb.prisma = previous; }
}
