import assert from "node:assert/strict";
import test from "node:test";
import type { CompResult } from "../domain/types.js";
import type { ReconciledComp } from "./compService.js";
import {
  createCompProgressEventFactory,
  encodeCompProgressEvent,
  parseCompProgressNdjson,
  pricedSourceCount,
} from "./progressContract.js";

const headline: CompResult = {
  source: "checked-comps",
  card: { name: "Gengar", setName: "Lost Origin", number: "TG06/TG30" },
  grade: "RAW",
  currency: "GBP",
  medianPence: 4200,
  meanPence: 4200,
  lowPence: 3900,
  highPence: 4500,
  sampleSize: 7,
  windowDays: 90,
  trendPct: null,
  outliersRemoved: 1,
  asOf: "2026-07-11T09:00:00.000Z",
};

const receipt: ReconciledComp = {
  headline,
  all: [headline],
  sourcesDisagree: false,
  reconciliation: {
    headlinePence: 4200,
    chosenSource: "checked-comps",
    confidence: "medium",
    manualCheck: false,
    reasons: [],
    trendPct: null,
  },
};

test("v1 progress events have monotonic sequence and NDJSON framing", () => {
  const factory = createCompProgressEventFactory({
    lookupId: "lookup-1",
    now: () => new Date("2026-07-11T10:00:00.000Z"),
  });
  const catalog = factory.next({
    type: "catalog",
    requested: headline.card,
    identity: headline.card,
    grade: "RAW",
    catalog: null,
    ambiguity: false,
    sources: [{ name: "checked-comps", live: true }],
  });
  const verdict = factory.next({
    type: "verdict",
    phase: "provisional",
    ambiguity: false,
    pricedSourceCount: 1,
    receipt,
  });

  const decoded = parseCompProgressNdjson(
    new TextDecoder().decode(encodeCompProgressEvent(catalog)) +
      new TextDecoder().decode(encodeCompProgressEvent(verdict)),
  );
  assert.deepEqual(decoded.map((event) => event.type), ["catalog", "verdict"]);
  assert.deepEqual(decoded.map((event) => event.sequence), [1, 2]);
  assert.ok(decoded.every((event) => event.version === 1 && event.lookupId === "lookup-1"));
});

test("price-bearing progress is a full confidence receipt, never bare pence", () => {
  const event = createCompProgressEventFactory({ lookupId: "lookup-2" }).next({
    type: "verdict",
    phase: "provisional",
    ambiguity: "pending",
    pricedSourceCount: 1,
    receipt,
  });
  assert.equal(event.type, "verdict");
  if (event.type !== "verdict") return;
  assert.equal(event.receipt.headline?.medianPence, 4200);
  assert.equal(event.receipt.headline?.sampleSize, 7);
  assert.equal(event.receipt.headline?.windowDays, 90);
  assert.equal(event.receipt.headline?.asOf, "2026-07-11T09:00:00.000Z");
  assert.equal(event.receipt.reconciliation?.confidence, "medium");
});

test("quorum counts distinct priced sources only", () => {
  assert.equal(pricedSourceCount(receipt), 1);
  assert.equal(
    pricedSourceCount({
      ...receipt,
      all: [headline, { ...headline, source: "poketrace" }, { ...headline, sampleSize: 0, medianPence: 0 }],
    }),
    2,
  );
});
