import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateDealSessionCost,
  roundBundleOfferDown,
  summarizeDealSession,
  type DealSessionLineInput,
} from "./dealSession.js";

const lines: DealSessionLineInput[] = [
  {
    id: "line_a",
    headlinePence: 5000,
    manualCheck: false,
    maxCashOfferPence: 3000,
    maxTradeOfferPence: 3300,
    netProceedsPence: 4200,
    expectedProfitPence: 1200,
  },
  {
    id: "line_b",
    headlinePence: 10000,
    manualCheck: false,
    maxCashOfferPence: 6200,
    maxTradeOfferPence: 6800,
    netProceedsPence: 8100,
    expectedProfitPence: 1900,
  },
  {
    id: "line_c",
    headlinePence: 9000,
    manualCheck: true,
    maxCashOfferPence: null,
    maxTradeOfferPence: null,
    netProceedsPence: 7000,
    expectedProfitPence: null,
  },
];
const lineA = lines[0]!;
const lineB = lines[1]!;
const lineC = lines[2]!;

test("summarizeDealSession excludes manual/no-quote lines from auto totals", () => {
  const summary = summarizeDealSession(lines);

  assert.equal(summary.includedCount, 2);
  assert.equal(summary.excludedCount, 1);
  assert.equal(summary.totalMaxCashPence, 9200);
  assert.equal(summary.totalMaxTradePence, 10100);
  assert.equal(summary.totalExpectedProceedsPence, 12300);
  assert.equal(summary.totalExpectedProfitPence, 3100);
  assert.equal(summary.suggestedBundleOfferPence, 9000);
  assert.equal(summary.completionReady, false);
  assert.deepEqual(summary.completionBlockers, ["1 manual/no-quote line need an override"]);
  assert.equal(summary.lines[2]?.status, "excluded");
});

test("summarizeDealSession includes manual-check line when dealer override is supplied", () => {
  const summary = summarizeDealSession([
    ...lines.slice(0, 2),
    { ...lineC, dealerOfferPence: 2500 },
  ]);

  assert.equal(summary.includedCount, 3);
  assert.equal(summary.excludedCount, 0);
  assert.equal(summary.totalMaxCashPence, 11700);
  assert.equal(summary.totalMaxTradePence, 12600);
  assert.equal(summary.suggestedBundleOfferPence, 11000);
  assert.equal(summary.completionReady, true);
  assert.equal(summary.lines[2]?.status, "override");
});

test("roundBundleOfferDown uses £5 below £100 and £10 at or above £100", () => {
  assert.equal(roundBundleOfferDown(9900), 9500);
  assert.equal(roundBundleOfferDown(10000), 10000);
  assert.equal(roundBundleOfferDown(10999), 10000);
});

test("allocateDealSessionCost allocates paid total proportionally and exactly", () => {
  const allocations = allocateDealSessionCost(
    [
      { ...lineA, maxCashOfferPence: 3000 },
      { ...lineB, maxCashOfferPence: 6000 },
      { ...lineC, dealerOfferPence: 1000 },
    ],
    7777,
  );

  assert.deepEqual(allocations, [
    { lineId: "line_a", basisPence: 3000, costBasisPence: 2333 },
    { lineId: "line_b", basisPence: 6000, costBasisPence: 4666 },
    { lineId: "line_c", basisPence: 1000, costBasisPence: 778 },
  ]);
  assert.equal(allocations.reduce((sum, line) => sum + line.costBasisPence, 0), 7777);
});

test("allocateDealSessionCost requires overrides for manual/no-quote included lines", () => {
  assert.throws(() => allocateDealSessionCost(lines, 5000), /need an override/);
});
