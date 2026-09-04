import { test } from "node:test";
import assert from "node:assert/strict";
import { PATCH, DELETE } from "../../app/api/sales/[id]/route.js";

const params = { params: Promise.resolve({ id: "sale-1" }) };
const input = { feesPence: 650, postagePence: 200, costBasisPence: 1800, itemRevenuePence: 4800, reason: "Checked actual order and acquisition receipt" };

test("sale confirmation keeps buyer payment and stock unchanged and appends an auditable revision", async () => {
  const sale = { id: "sale-1", itemId: "item-1", salePrice: 5000, fees: 600, postage: 175, costBasis: null, itemRevenue: null, costsEstimated: true, amountRevisions: null };
  let updateCount = 0;
  const calls: string[] = [];
  const db = {
    async $transaction(fn: (tx: unknown) => unknown) { return fn(db); },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      calls.push("locked");
      assert.match(strings.join("?"), /FOR UPDATE/);
      assert.deepEqual(values, ["sale-1"]);
      return [{ id: "sale-1" }];
    },
    sale: {
      async findUnique() { calls.push("read"); return sale; },
      async update({ data }: { data: Record<string, unknown> }) { updateCount += 1; Object.assign(sale, data); return sale; },
    },
  };
  await withDb(db, async () => {
    const first = await PATCH(request(input), params);
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.equal(result.sale.salePrice, 5000);
    assert.equal(result.sale.costBasis, 1800);
    assert.equal(result.sale.costsEstimated, false);
    assert.equal(result.sale.amountRevisions[0].before.costBasis, null);
    assert.equal(result.sale.amountRevisions[0].reason, input.reason);
    assert.deepEqual(calls.slice(0, 2), ["locked", "read"]);
    const retry = await PATCH(request(input), params);
    assert.equal((await retry.json()).idempotent, true);
    assert.equal(updateCount, 1);
  });
});

test("sale confirmation rejects an impossible item amount without writing", async () => {
  const db = {
    async $transaction(fn: (tx: unknown) => unknown) { return fn(db); },
    async $queryRaw() { return [{ id: "sale-1" }]; },
    sale: { async findUnique() { return { salePrice: 5000 }; }, async update() { assert.fail("invalid amounts must never write"); } },
  };
  await withDb(db, async () => {
    const response = await PATCH(request({ ...input, itemRevenuePence: 5001 }), params);
    assert.equal(response.status, 400);
  });
});

test("undo preserves imported sale rows including non-first units of an eBay order", async () => {
  const db = {
    async $transaction(fn: (tx: unknown) => unknown) { return fn(db); },
    async $queryRaw() { return [{ id: "row" }]; },
    sale: {
      async findUnique() { return { id: "sale-1", itemId: "item-1", salePrice: 5000, fees: 0, postage: 0, costBasis: 1000, clientMutationId: "ebay-order:order:line", ebayOrderImport: null }; },
      async delete() { assert.fail("imported sale must be retained"); },
    },
  };
  await withDb(db, async () => {
    const response = await DELETE(new Request("http://localhost/api/sales/sale-1", { method: "DELETE" }), params);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /cannot be undone/);
  });
});

function request(body: unknown) {
  return new Request("http://localhost/api/sales/sale-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function withDb(db: unknown, run: () => Promise<void>) {
  const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
  const previous = globalDb.prisma;
  globalDb.prisma = db;
  try { await run(); } finally { globalDb.prisma = previous; }
}
