import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompResult } from "../domain/types.js";
import { warmComps, type WarmCompItem } from "./warmComps.js";

const items: WarmCompItem[] = Array.from({ length: 6 }, (_, index) => ({
  id: `item_${index + 1}`,
  card: { name: `Card ${index + 1}`, setName: "Test Set" },
  grade: "RAW",
}));

test("warmComps caps scanned items and reports skipped rows", async () => {
  const summary = await warmComps(items, async (item) => pricedComp(item.id), { limit: 4, concurrency: 2 });

  assert.equal(summary.scanned, 4);
  assert.equal(summary.skipped, 2);
  assert.equal(summary.refreshed, 4);
  assert.equal(summary.failed, 0);
});

test("warmComps runs with bounded concurrency", async () => {
  let inFlight = 0;
  let maxInFlight = 0;

  await warmComps(
    items,
    async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return pricedComp(item.id);
    },
    { concurrency: 3 },
  );

  assert.equal(maxInFlight, 3);
});

test("warmComps keeps going when one lookup fails or returns no price", async () => {
  const summary = await warmComps(items.slice(0, 3), async (item) => {
    if (item.id === "item_2") throw new Error("source down");
    if (item.id === "item_3") return { ...pricedComp(item.id), medianPence: 0, sampleSize: 0 };
    return pricedComp(item.id);
  });

  assert.equal(summary.refreshed, 1);
  assert.equal(summary.failed, 2);
  assert.deepEqual(summary.failures.map((failure) => failure.itemId), ["item_2", "item_3"]);
});

test("warmComps completes when one source has cooled down mid-run", async () => {
  let cooledDown = false;
  const summary = await warmComps(items.slice(0, 4), async (item) => {
    if (item.id === "item_1") {
      cooledDown = true;
      throw new Error("PokeTrace source unavailable: rate limited");
    }
    return pricedComp(item.id);
  }, { concurrency: 2 });

  assert.equal(cooledDown, true);
  assert.equal(summary.scanned, 4);
  assert.equal(summary.refreshed, 3);
  assert.equal(summary.failed, 1);
  assert.match(summary.failures[0]?.reason ?? "", /source unavailable/);
});

function pricedComp(id: string): CompResult {
  return {
    source: "test",
    card: { name: id, setName: "Test Set" },
    grade: "RAW",
    currency: "GBP",
    medianPence: 1200,
    meanPence: 1200,
    lowPence: 1000,
    highPence: 1400,
    sampleSize: 5,
    windowDays: 30,
    trendPct: null,
    outliersRemoved: 0,
    asOf: "2026-07-02T12:00:00.000Z",
  };
}
