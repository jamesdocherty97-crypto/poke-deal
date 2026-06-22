import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWatch, formatWatchDigest } from "./watchlist.js";
import type { CompResult } from "../domain/types.js";

const comp: CompResult = {
  source: "pokemon-price-tracker",
  card: { name: "Charizard ex", setName: "151", number: "199/165" },
  grade: "RAW",
  currency: "GBP",
  medianPence: 3000,
  meanPence: 3100,
  lowPence: 2800,
  highPence: 3400,
  sampleSize: 12,
  windowDays: 90,
  trendPct: null,
  outliersRemoved: 0,
  asOf: "2026-06-22T00:00:00.000Z",
};

test("checkWatch returns a hit when market is at or below target", () => {
  const hit = checkWatch({
    watchId: "watch_1",
    cardName: "Charizard ex",
    grade: "RAW",
    targetPence: 3500,
    comp,
  });

  assert.equal(hit?.marketPence, 3000);
  assert.match(hit?.message ?? "", /£30\.00 vs target £35\.00/);
});

test("checkWatch ignores watches above target or without comp data", () => {
  assert.equal(
    checkWatch({ watchId: "watch_1", cardName: "Charizard ex", grade: "RAW", targetPence: 2500, comp }),
    null,
  );
  assert.equal(
    checkWatch({
      watchId: "watch_1",
      cardName: "Charizard ex",
      grade: "RAW",
      targetPence: 3500,
      comp: { ...comp, sampleSize: 0, medianPence: 0 },
    }),
    null,
  );
});

test("formatWatchDigest is compact for notifier delivery", () => {
  const hit = checkWatch({
    watchId: "watch_1",
    cardName: "Charizard ex",
    grade: "RAW",
    targetPence: 3500,
    comp,
  });
  assert.equal(formatWatchDigest(hit ? [hit] : []), hit?.message);
  assert.equal(formatWatchDigest([]), "No sourcing targets hit right now.");
});
