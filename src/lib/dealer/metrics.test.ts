import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProfitTrend, computeDealerMetrics, summarizeSale } from "./metrics.js";

const NOW = new Date("2026-06-21T12:00:00.000Z");

test("summarizeSale computes GBP pence profit and margin", () => {
  const sale = summarizeSale({
    id: "sale_1",
    itemId: "item_1",
    name: "Charizard ex",
    grade: "RAW",
    channel: "EBAY",
    salePricePence: 3000,
    feesPence: 414,
    postagePence: 120,
    costBasisPence: 1800,
    soldAt: "2026-06-21T10:00:00.000Z",
  });

  assert.equal(sale.profitPence, 666);
  assert.equal(sale.marginPct, 22.2);
  assert.equal(sale.channel, "EBAY");
  assert.equal(sale.salePricePence, 3000);
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
        channel: "IN_PERSON",
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
  assert.equal(metrics.soldCostPence, 1000);
  assert.equal(metrics.realizedRevenuePence, 2200);
  assert.equal(metrics.realizedFeesPence, 300);
  assert.equal(metrics.realizedPostagePence, 100);
  assert.equal(metrics.realizedProfitPence, 800);
  assert.equal(metrics.operatingExpensePence, 0);
  assert.equal(metrics.netProfitPence, 800);
  assert.equal(metrics.cashInPence, 2200);
  assert.equal(metrics.cashOutPence, 14000);
  assert.equal(metrics.cashNetPence, -11800);
  assert.equal(metrics.cashRecoveryPct, 15.7);
  assert.equal(metrics.realizedMarginPct, 36.4);
  assert.equal(metrics.sellThroughPct, 25);
  assert.equal(metrics.averageAgeDays, 51);
  assert.equal(metrics.agedStockCount, 1);
  assert.equal(metrics.bestSale?.name, "Venusaur ex");
  assert.equal(metrics.worstSale?.profitPence, 800);
});

test("computeDealerMetrics subtracts operating expenses from net profit", () => {
  const metrics = computeDealerMetrics(
    [],
    [
      {
        id: "sale_1",
        itemId: "item_1",
        name: "Gengar",
        grade: "RAW",
        channel: "EBAY",
        salePricePence: 5000,
        feesPence: 650,
        postagePence: 120,
        costBasisPence: 2500,
        soldAt: "2026-06-20T12:00:00.000Z",
      },
    ],
    NOW,
    [
      {
        id: "expense_1",
        category: "TABLE_FEE",
        description: "Card fair table",
        amountPence: 1500,
        spentAt: "2026-06-20T08:00:00.000Z",
      },
      {
        id: "expense_2",
        category: "SUPPLIES",
        description: "Toploaders",
        amountPence: 600,
        spentAt: "2026-06-20T09:00:00.000Z",
      },
    ],
  );

  assert.equal(metrics.realizedProfitPence, 1730);
  assert.equal(metrics.operatingExpensePence, 2100);
  assert.equal(metrics.netProfitPence, -370);
  assert.equal(metrics.cashInPence, 5000);
  assert.equal(metrics.cashOutPence, 5370);
  assert.equal(metrics.cashNetPence, -370);
  assert.equal(metrics.cashRecoveryPct, 93.1);
});

test("computeDealerMetrics counts partial sales from duplicate stock as sold units", () => {
  const metrics = computeDealerMetrics(
    [
      {
        id: "item_1",
        name: "Gengar",
        grade: "RAW",
        status: "LISTED",
        quantity: 2,
        costBasisPence: 1200,
        createdAt: "2026-06-01T12:00:00.000Z",
      },
    ],
    [
      {
        id: "sale_1",
        itemId: "item_1",
        name: "Gengar",
        grade: "RAW",
        channel: "CARDMARKET",
        salePricePence: 2500,
        feesPence: 300,
        postagePence: 120,
        costBasisPence: 1200,
        soldAt: "2026-06-20T12:00:00.000Z",
      },
    ],
    NOW,
  );

  assert.equal(metrics.listedCount, 2);
  assert.equal(metrics.soldCount, 1);
  assert.equal(metrics.activeCostPence, 2400);
  assert.equal(metrics.sellThroughPct, 33.3);
});

test("buildProfitTrend aggregates daily profit into a cumulative trend", () => {
  const points = buildProfitTrend([
    { profitPence: 500, soldAt: "2026-06-21T10:00:00.000Z" },
    { profitPence: -150, soldAt: "2026-06-21T13:00:00.000Z" },
    { profitPence: 900, soldAt: "2026-06-22T10:00:00.000Z" },
    { profitPence: 400, soldAt: "not a date" },
  ]);

  assert.deepEqual(points, [
    { date: "2026-06-21", profitPence: 350, cumulativeProfitPence: 350 },
    { date: "2026-06-22", profitPence: 900, cumulativeProfitPence: 1250 },
  ]);
});

test("buildProfitTrend limits to the latest points without losing cumulative history", () => {
  const points = buildProfitTrend(
    [
      { profitPence: 100, soldAt: "2026-06-18T10:00:00.000Z" },
      { profitPence: 200, soldAt: "2026-06-19T10:00:00.000Z" },
      { profitPence: 300, soldAt: "2026-06-20T10:00:00.000Z" },
    ],
    2,
  );

  assert.deepEqual(points, [
    { date: "2026-06-19", profitPence: 200, cumulativeProfitPence: 300 },
    { date: "2026-06-20", profitPence: 300, cumulativeProfitPence: 600 },
  ]);
});
