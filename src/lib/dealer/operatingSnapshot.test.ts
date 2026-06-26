import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOperatingSnapshot } from "./operatingSnapshot.js";

test("buildOperatingSnapshot summarizes early trading cash and listing state", () => {
  const rows = buildOperatingSnapshot({
    activeCostPence: 14500,
    cashInPence: 0,
    cashOutPence: 14500,
    cashNetPence: -14500,
    cashRecoveryPct: 0,
    sellThroughPct: 0,
    draftListings: 7,
    activeListings: 1,
  });

  assert.deepEqual(rows.map((row) => row.id), ["stock-cost", "cash-net", "listing-pipeline", "sell-through"]);
  assert.equal(rows[0]?.value, "£145.00");
  assert.equal(rows[1]?.value, "-£145.00");
  assert.equal(rows[2]?.value, "1 live / 7 draft");
  assert.equal(rows[3]?.detail, "0% cash recovery");
});

test("buildOperatingSnapshot marks profitable cash net as good", () => {
  const rows = buildOperatingSnapshot({
    activeCostPence: 5000,
    cashInPence: 15000,
    cashOutPence: 10000,
    cashNetPence: 5000,
    cashRecoveryPct: 150,
    sellThroughPct: 37.5,
    draftListings: 0,
    activeListings: 3,
  });

  assert.equal(rows.find((row) => row.id === "cash-net")?.tone, "good");
  assert.equal(rows.find((row) => row.id === "cash-net")?.value, "+£50.00");
  assert.equal(rows.find((row) => row.id === "sell-through")?.value, "37.5%");
  assert.equal(rows.find((row) => row.id === "listing-pipeline")?.tone, "good");
});
