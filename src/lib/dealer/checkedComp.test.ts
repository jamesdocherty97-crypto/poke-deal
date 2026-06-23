import assert from "node:assert/strict";
import test from "node:test";

import { buildCheckedComp, checkedCompSourceLabel } from "./checkedComp.js";

const card = {
  name: "Gengar",
  setName: "Lost Origin Trainer Gallery",
  number: "TG06/TG30",
} as const;

test("buildCheckedComp creates a full GBP comp from a checked sold price", () => {
  const comp = buildCheckedComp({
    card,
    grade: "RAW",
    pricePence: 2400,
    sampleSize: 3,
    windowDays: 14,
    source: "EBAY_SOLD",
    note: "three NM solds",
    asOf: "2026-06-23T10:00:00.000Z",
  });

  assert.ok(comp);
  assert.equal(comp.source, "manual-check");
  assert.equal(comp.currency, "GBP");
  assert.equal(comp.medianPence, 2400);
  assert.equal(comp.sampleSize, 3);
  assert.equal(comp.windowDays, 14);
  assert.equal(comp.asOf, "2026-06-23T10:00:00.000Z");
  assert.deepEqual(comp.raw, {
    kind: "checked-comp",
    source: "EBAY_SOLD",
    sourceLabel: "eBay sold",
    note: "three NM solds",
  });
});

test("buildCheckedComp refuses empty or invalid prices", () => {
  assert.equal(buildCheckedComp({ card, grade: "RAW", pricePence: 0 }), null);
  assert.equal(buildCheckedComp({ card, grade: "RAW", pricePence: Number.NaN }), null);
});

test("buildCheckedComp keeps confidence metadata even for a single checked sale", () => {
  const comp = buildCheckedComp({
    card,
    grade: "PSA_10",
    pricePence: 7200,
    sampleSize: -2,
    windowDays: Number.NaN,
    source: "CARDMARKET",
    note: "   ",
    asOf: "2026-06-23T10:00:00.000Z",
  });

  assert.ok(comp);
  assert.equal(comp.sampleSize, 1);
  assert.equal(comp.windowDays, 30);
  assert.deepEqual(comp.raw, {
    kind: "checked-comp",
    source: "CARDMARKET",
    sourceLabel: "Cardmarket",
  });
});

test("checkedCompSourceLabel uses dealer-facing source names", () => {
  assert.equal(checkedCompSourceLabel("EBAY_SOLD"), "eBay sold");
  assert.equal(checkedCompSourceLabel("TCGPLAYER"), "TCGPlayer");
  assert.equal(checkedCompSourceLabel("OTHER"), "Checked comp");
});
