import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotDate, snapshotDateKey, summarizePortfolioHistory } from "./portfolio.js";

test("snapshotDate normalizes to UTC day start", () => {
  assert.equal(snapshotDate(new Date("2026-06-22T23:45:00.000Z")).toISOString(), "2026-06-22T00:00:00.000Z");
});

test("summarizePortfolioHistory weights snapshots by current active quantity", () => {
  const summary = summarizePortfolioHistory(
    [
      { cardId: "card_1", grade: "RAW", quantity: 2 },
      { cardId: "card_2", grade: "PSA_10", quantity: 1 },
    ],
    [
      { cardId: "card_1", grade: "RAW", marketPence: 1000, takenAt: "2026-06-21T00:00:00.000Z" },
      { cardId: "card_2", grade: "PSA_10", marketPence: 5000, takenAt: "2026-06-21T00:00:00.000Z" },
      { cardId: "card_1", grade: "RAW", marketPence: 1200, takenAt: "2026-06-22T00:00:00.000Z" },
      { cardId: "card_2", grade: "PSA_10", marketPence: 4500, takenAt: "2026-06-22T00:00:00.000Z" },
      { cardId: "ignored", grade: "RAW", marketPence: 999999, takenAt: "2026-06-22T00:00:00.000Z" },
    ],
  );

  assert.deepEqual(summary.points, [
    { date: "2026-06-21", marketValuePence: 7000, snapshotCount: 2 },
    { date: "2026-06-22", marketValuePence: 6900, snapshotCount: 2 },
  ]);
  assert.equal(summary.latest?.marketValuePence, 6900);
  assert.equal(summary.changePence, -100);
  assert.equal(summary.changePct, -1.4);
});

test("snapshotDateKey returns a yyyy-mm-dd key", () => {
  assert.equal(snapshotDateKey(new Date("2026-06-22T12:00:00.000Z")), "2026-06-22");
});
