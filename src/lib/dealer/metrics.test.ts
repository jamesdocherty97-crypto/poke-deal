import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDealerMetrics, summarizeSale } from "./metrics.js";

const NOW = new Date("2026-06-21T12:00:00.000Z");

test("summarizeSale computes GBP pence profit and margin", () => {
  const sale = summarizeSale({
    id: "sale_1",
    itemId: "item_1",
    name: "Charizard ex",
    grade: "RAW",
    salePricePence: 3000,
    feesPence: 414,
    postagePence: 120,
    costBasisPence: 1800,
    soldAt: "2026-06-21T10:00:00.000Z",
  });

  assert.equal(sale.profitPence, 666);
  assert.equal(sale.marginPct, 22.2);
});

test("computeDealerMetrics summarizes stock, sales, age and movers", () => {
  const metrics = computeDealerMetrics(
    [
      {
        id: "item_1",
        name: "Charizard ex",
        grade: "RAW",
        status: "IN_STOCK",
        quantity: 2,
        costBasisPence: 1800,
        createdAt: "2026-06-01T12:00:00.000Z",
      },
      {
        id: "item_2",
        name: "Blastoise ex",
        grade: "PSA_10",
        status: "LISTED",
        quantity: 1,
        costBasisPence: 9000,
        createdAt: "2026-04-01T12:00:00.000Z",
      },
      {
        id: "item_3",
        name: "Venusaur ex",
        grade: "RAW",
        status: "SOLD",
        quantity: 1,
        costBasisPence: 1000,
        createdAt: "2026-05-01T12:00:00.000Z",
      },
    ],
    [
      {
        id: "sale_1",
        itemId: "item_3",
        name: "Venusaur ex",
        grade: "RAW",
        salePricePence: 2200,
        feesPence: 300,
        postagePence: 100,
        costBasisPence: 1000,
        soldAt: "2026-06-20T12:00:00.000Z",
      },
    ],
    NOW,
  );

  assert.equal(metrics.stockCount, 2);
  assert.equal(metrics.listedCount, 1);
  assert.equal(metrics.soldCount, 1);
  assert.equal(metrics.activeCostPence, 12600);
  assert.equal(metrics.realizedRevenuePence, 2200);
  assert.equal(metrics.realizedProfitPence, 800);
  assert.equal(metrics.realizedMarginPct, 36.4);
  assert.equal(metrics.sellThroughPct, 33.3);
  assert.equal(metrics.averageAgeDays, 51);
  assert.equal(metrics.agedStockCount, 1);
  assert.equal(metrics.bestSale?.name, "Venusaur ex");
  assert.equal(metrics.worstSale?.profitPence, 800);
});
