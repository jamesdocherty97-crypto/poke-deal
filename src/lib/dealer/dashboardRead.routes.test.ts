import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../app/api/dashboard/route.js";

test("lean dashboard reads preserve profit, legacy evidence, revisions and listing counts", async () => {
  const date = new Date("2026-09-01T12:00:00Z");
  const sale = {
    id: "sale-confirmed", channel: "EBAY", soldAt: date,
    salePrice: 5000, fees: 500, postage: 200, costBasis: 2000,
    itemRevenue: 4800, costsEstimated: false, amountRevisions: null,
    clientMutationId: "sale-client-1",
  };
  const items = [{
    id: "item-1", grade: "RAW", status: "LISTED", quantity: 2,
    costBasis: 9000, createdAt: date, acquiredAt: new Date("2026-01-01"),
    location: "unused", card: { name: "Gengar", imageUrl: "unused", setName: "unused" },
    listings: [{ state: "ACTIVE", description: "x".repeat(50_000) }, { state: "ENDED", title: "unused" }],
    sales: [
      sale,
      { ...sale, id: "sale-legacy", costBasis: null, itemRevenue: null, costsEstimated: null },
      { ...sale, id: "sale-revised", amountRevisions: [{ reason: "Receipt checked" }] },
      { ...sale, id: "sale-imported", clientMutationId: "ebay-order:order:line" },
    ],
  }];
  const expenses = [{ id: "expense-1", category: "SUPPLIES", description: "Mailers", amount: 500, spentAt: date, channel: null, source: null }];
  const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
  const previous = globalDb.prisma;
  let useProjection = false;
  globalDb.prisma = {
    inventoryItem: {
      async findMany(args: any) {
        assert.equal(args.include, undefined);
        assert.deepEqual(args.select.listings, { select: { state: true } });
        assert.deepEqual(args.select.card, { select: { name: true } });
        assert.equal(args.select.sales.orderBy, undefined, "the final merged sales list already sorts by date");
        return useProjection ? items.map((item) => project(item, args.select)) : items;
      },
    },
    expense: { async findMany() { return expenses; } },
  };
  try {
    const baseline = await GET();
    assert.equal(baseline.status, 200);
    const expected = await baseline.json();
    useProjection = true;
    const lean = await GET();
    assert.equal(lean.status, 200);
    const actual = await lean.json();
    assert.deepEqual(actual, expected);
    assert.equal(actual.salesToReconcileCount, 1);
    assert.deepEqual(actual.listingsByState, { ACTIVE: 1, ENDED: 1 });
    const confirmed = actual.recentSales.find((row: any) => row.id === "sale-confirmed");
    assert.equal(confirmed.costBasisPence, 2000, "historical cost must not become current inventory cost");
    const revised = actual.recentSales.find((row: any) => row.id === "sale-revised");
    assert.equal(revised.amountRevisionCount, 1);
    assert.equal(revised.undoable, false);
    assert.equal(actual.recentSales.find((row: any) => row.id === "sale-imported").undoable, false);
  } finally {
    globalDb.prisma = previous;
  }
});

// Enforce the actual Prisma projection: a full-row mock would hide a missing
// accounting field and let a query optimisation silently alter the result.
function project(row: any, select: Record<string, any>): any {
  return Object.fromEntries(Object.entries(select).map(([key, shape]) => [key,
    shape === true ? row[key] : Array.isArray(row[key])
      ? row[key].map((value: any) => project(value, shape.select))
      : project(row[key], shape.select),
  ]));
}
