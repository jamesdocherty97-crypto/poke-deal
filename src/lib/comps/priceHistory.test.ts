import assert from "node:assert/strict";
import test from "node:test";
import {
  cardGradeHistoryKey,
  readCardPriceHistory,
  readCardPriceHistoryPreviews,
  type PriceHistoryDb,
  type PriceHistoryPreviewDb,
} from "./priceHistory.js";

test("price history joins pence-safe snapshots, comps, acquisitions and sales", async () => {
  const db: PriceHistoryDb = {
    card: {
      async findUnique() {
        return { id: "card_1", name: "Gengar", setName: "Lost Origin", number: "TG06/TG30", imageUrl: null, displayImageUrl: null };
      },
    },
    priceSnapshot: {
      async findMany() {
        return [{ takenAt: new Date("2026-07-10T00:00:00.000Z"), marketPence: 4200 }];
      },
    },
    compResult: {
      async findMany() {
        return [{
          id: "comp_1",
          grade: "RAW",
          asOf: new Date("2026-07-10T00:00:00.000Z"),
          createdAt: new Date("2026-07-10T00:00:01.000Z"),
          medianPence: 4200,
          source: "checked-comps",
          currency: "GBP",
          sampleSize: 7,
          windowDays: 90,
          confidence: "medium",
          manualCheck: false,
          receipt: {
            all: [{
              source: "checked-comps",
              grade: "RAW",
              currency: "GBP",
              medianPence: 4200,
              sampleSize: 7,
              windowDays: 90,
              asOf: "2026-07-10T00:00:00.000Z",
              raw: { region: "EU" },
            }],
          },
        }];
      },
    },
    inventoryItem: {
      async findMany() {
        return [{
          id: "item_1",
          acquiredAt: new Date("2026-07-01T00:00:00.000Z"),
          costBasis: 2500,
          listings: [{
            id: "listing_1",
            createdAt: new Date("2026-07-02T00:00:00.000Z"),
            updatedAt: new Date("2026-07-03T00:00:00.000Z"),
            suggestedPrice: 4500,
            listPrice: 4750,
            state: "ACTIVE",
            channel: "EBAY",
          }],
          sales: [{ soldAt: new Date("2026-07-11T00:00:00.000Z"), salePrice: 5000, fees: 500, postage: 250 }],
        }];
      },
    },
  };

  const history = await readCardPriceHistory(db, {
    cardId: "card_1",
    grade: "RAW",
    days: 30,
    now: new Date("2026-07-11T12:00:00.000Z"),
  });
  assert.equal(history?.snapshots[0]?.marketPence, 4200);
  assert.equal(history?.comps[0]?.sampleSize, 7);
  assert.equal(history?.inventory[0]?.costBasis, 2500);
  assert.deepEqual(history?.listings[0], {
    itemId: "item_1",
    id: "listing_1",
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    suggestedPrice: 4500,
    listPrice: 4750,
    state: "ACTIVE",
    channel: "EBAY",
  });
  assert.deepEqual(history?.sales[0], {
    itemId: "item_1",
    soldAt: "2026-07-11T00:00:00.000Z",
    salePrice: 5000,
    fees: 500,
    postage: 250,
  });
  assert.deepEqual(history?.receipt?.evidence, [{
    id: "comp_1:headline:0",
    persistedCompId: "comp_1",
    role: "headline",
    provider: "checked-comps",
    market: "EU",
    grade: "RAW",
    currency: "GBP",
    medianPence: 4200,
    sampleSize: 7,
    windowDays: 90,
    asOf: "2026-07-10T00:00:00.000Z",
    recordedAt: "2026-07-10T00:00:01.000Z",
    confidence: "medium",
    manualCheck: false,
    status: "priced",
    reason: null,
  }]);
  assert.deepEqual(history?.receipt?.metrics.liquidity, {
    status: "available",
    reason: null,
    salesPer30Days: 2.3,
    provider: "checked-comps",
    market: "EU",
    grade: "RAW",
    currency: "GBP",
    sampleSize: 7,
    windowDays: 90,
    asOf: "2026-07-10T00:00:00.000Z",
    ageDays: 1.5,
  });
  assert.equal(history?.receipt?.metrics.volatility.status, "insufficient");
  assert.equal(history?.receipt?.metrics.volatility.reason, "minimum-observations");
});

test("batch previews use two queries, prefer snapshots and expose only genuine sold receipts", async () => {
  const calls: { snapshots: unknown[]; comps: unknown[] } = { snapshots: [], comps: [] };
  const snapshots = Array.from({ length: 24 }, (_, index) => ({
    cardId: "card_1",
    grade: "RAW" as const,
    takenAt: new Date(`2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
    marketPence: 3_000 + index * 10,
  }));
  const db: PriceHistoryPreviewDb = {
    priceSnapshot: {
      async findMany(args) {
        calls.snapshots.push(args);
        return snapshots;
      },
    },
    compResult: {
      async findMany(args) {
        calls.comps.push(args);
        return [
          {
            cardId: "card_1",
            grade: "RAW",
            source: "pokemon-tcg-market",
            medianPence: 9_999,
            sampleSize: 100,
            windowDays: 30,
            asOf: new Date("2026-07-08T00:00:00.000Z"),
            createdAt: new Date("2026-07-08T00:01:00.000Z"),
            manualCheck: false,
            receipt: {
              all: [
                {
                  grade: "RAW",
                  source: "checked-comps",
                  medianPence: 4_200,
                  sampleSize: 7,
                  windowDays: 90,
                  asOf: "2026-07-10T00:00:00.000Z",
                  raw: { kind: "checked-comps", region: "EU" },
                },
                {
                  grade: "RAW",
                  source: "pokemon-tcg-market",
                  medianPence: 12_345,
                  sampleSize: 500,
                  windowDays: 7,
                  asOf: "2026-07-11T00:00:00.000Z",
                },
              ],
            },
          },
          {
            cardId: "card_2",
            grade: "PSA_9",
            source: "pokemon-tcg-market",
            medianPence: 8_000,
            sampleSize: 30,
            windowDays: 30,
            asOf: new Date("2026-07-09T00:00:00.000Z"),
            createdAt: new Date("2026-07-09T00:01:00.000Z"),
            manualCheck: false,
            receipt: null,
          },
          {
            cardId: "card_3",
            grade: "RAW",
            source: "owned-sales",
            medianPence: 2_100,
            sampleSize: 3,
            windowDays: 90,
            asOf: new Date("2026-07-10T00:00:00.000Z"),
            createdAt: new Date("2026-07-10T00:01:00.000Z"),
            manualCheck: true,
            receipt: null,
          },
        ];
      },
    },
  };

  const previews = await readCardPriceHistoryPreviews(db, [
    { cardId: "card_1", grade: "RAW" },
    { cardId: "card_1", grade: "RAW" },
    { cardId: "card_2", grade: "PSA_9" },
    { cardId: "card_3", grade: "RAW" },
  ], { now: new Date("2026-07-11T12:00:00.000Z") });

  assert.equal(calls.snapshots.length, 1);
  assert.equal(calls.comps.length, 1);
  assert.equal(previews.length, 3);

  const card1 = previews.find((preview) => preview.key === cardGradeHistoryKey("card_1", "RAW"));
  assert.equal(card1?.market.length, 16);
  assert.equal(card1?.market[0]?.marketPence, 3_000);
  assert.equal(card1?.market.at(-1)?.marketPence, 3_230);
  assert.deepEqual(card1?.soldEvidence, {
    source: "checked-comps",
    medianPence: 4_200,
    sampleSize: 7,
    windowDays: 90,
    asOf: "2026-07-10T00:00:00.000Z",
    sourceRegion: "EU",
  });

  const card2 = previews.find((preview) => preview.key === cardGradeHistoryKey("card_2", "PSA_9"));
  assert.deepEqual(card2?.market, [{ takenAt: "2026-07-09T00:00:00.000Z", marketPence: 8_000 }]);
  assert.equal(card2?.soldEvidence, null, "market baselines must never become sold evidence");

  const card3 = previews.find((preview) => preview.key === cardGradeHistoryKey("card_3", "RAW"));
  assert.equal(card3?.soldEvidence, null, "manual-check valuations stay internal");
});

test("a complete allow-listed provider sold aggregate is valid evidence", async () => {
  const db: PriceHistoryPreviewDb = {
    priceSnapshot: { async findMany() { return []; } },
    compResult: {
      async findMany() {
        return [{
          cardId: "card_4",
          grade: "RAW",
          source: "pokemon-price-tracker",
          medianPence: 5_500,
          sampleSize: 18,
          windowDays: 30,
          asOf: new Date("2026-07-10T00:00:00.000Z"),
          createdAt: new Date("2026-07-10T00:01:00.000Z"),
          manualCheck: false,
          receipt: null,
        }];
      },
    },
  };
  const [preview] = await readCardPriceHistoryPreviews(db, [{ cardId: "card_4", grade: "RAW" }]);
  assert.deepEqual(preview?.soldEvidence, {
    source: "pokemon-price-tracker",
    medianPence: 5_500,
    sampleSize: 18,
    windowDays: 30,
    asOf: "2026-07-10T00:00:00.000Z",
  });
});

test("history receipt reports deterministic liquidity, volatility, trend, disagreement and provider provenance", async () => {
  const observations = [
    ["2026-06-01T00:00:00.000Z", 1_000],
    ["2026-06-10T00:00:00.000Z", 1_100],
    ["2026-06-20T00:00:00.000Z", 900],
    ["2026-07-01T00:00:00.000Z", 1_200],
    ["2026-07-10T00:00:00.000Z", 1_000],
  ] as const;
  const rows: HistoryCompTestRow[] = observations.map(([asOf, medianPence], index) => ({
    id: `ppt_${index}`,
    grade: "RAW",
    asOf: new Date(asOf),
    createdAt: new Date(Date.parse(asOf) + 1_000),
    medianPence,
    source: "pokemon-price-tracker",
    currency: "GBP",
    sampleSize: 10,
    windowDays: 30,
    confidence: "high",
    manualCheck: false,
    receipt: index === observations.length - 1
      ? {
          all: [
            {
              source: "pokemon-price-tracker",
              grade: "RAW",
              currency: "GBP",
              medianPence,
              sampleSize: 10,
              windowDays: 30,
              asOf,
            },
            {
              source: "checked-comps",
              grade: "RAW",
              currency: "GBP",
              medianPence: 1_500,
              sampleSize: 6,
              windowDays: 30,
              asOf,
              raw: { region: "UK" },
            },
            {
              source: "poketrace",
              grade: "RAW",
              currency: "GBP",
              medianPence: 0,
              sampleSize: 0,
              windowDays: 30,
              asOf,
              raw: { market: "EU", reason: "Provider unavailable for this market." },
            },
          ],
        }
      : null,
  }));

  const history = await readCardPriceHistory(historyDb(rows), {
    cardId: "card_metrics",
    grade: "RAW",
    days: 90,
    now: new Date("2026-07-11T00:00:00.000Z"),
  });
  const receipt = history?.receipt;
  assert.ok(receipt);
  assert.equal(receipt.policy.minSoldSampleSize, 3);
  assert.equal(receipt.policy.maxEvidenceAgeDays, 45);
  assert.deepEqual(receipt.metrics.liquidity, {
    status: "available",
    reason: null,
    salesPer30Days: 10,
    provider: "pokemon-price-tracker",
    market: "US",
    grade: "RAW",
    currency: "GBP",
    sampleSize: 10,
    windowDays: 30,
    asOf: "2026-07-10T00:00:00.000Z",
    ageDays: 1,
  });
  assert.deepEqual(receipt.metrics.volatility, {
    status: "available",
    reason: null,
    medianPence: 1_000,
    madPence: 100,
    madPct: 10,
    observationCount: 5,
    minimumSampleSize: 10,
    provider: "pokemon-price-tracker",
    market: "US",
    grade: "RAW",
    currency: "GBP",
    from: "2026-06-01T00:00:00.000Z",
    to: "2026-07-10T00:00:00.000Z",
    latestAgeDays: 1,
  });
  assert.equal(receipt.metrics.trend30Days.status, "available");
  assert.equal(receipt.metrics.trend30Days.changePct, -9.1);
  assert.equal(receipt.metrics.trend30Days.observationCount, 4);
  assert.equal(receipt.metrics.trend90Days.status, "available");
  assert.equal(receipt.metrics.trend90Days.changePct, 0);
  assert.deepEqual(receipt.metrics.sourceDisagreement, {
    status: "available",
    reason: null,
    spreadPct: 40,
    lowPence: 1_000,
    highPence: 1_500,
    sourceCount: 2,
    asOf: "2026-07-10T00:00:00.000Z",
    evidence: [
      {
        id: "ppt_4:supporting:1",
        provider: "checked-comps",
        market: "UK",
        grade: "RAW",
        currency: "GBP",
        medianPence: 1_500,
        sampleSize: 6,
        asOf: "2026-07-10T00:00:00.000Z",
      },
      {
        id: "ppt_4:headline:0",
        provider: "pokemon-price-tracker",
        market: "US",
        grade: "RAW",
        currency: "GBP",
        medianPence: 1_000,
        sampleSize: 10,
        asOf: "2026-07-10T00:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(receipt.providerAvailability, [
    { provider: "checked-comps", status: "priced", reason: null, asOf: "2026-07-10T00:00:00.000Z" },
    { provider: "pokemon-price-tracker", status: "priced", reason: null, asOf: "2026-07-10T00:00:00.000Z" },
    { provider: "poketrace", status: "unavailable", reason: "Provider unavailable for this market.", asOf: "2026-07-10T00:00:00.000Z" },
  ]);
  const unavailable = receipt.evidence.find((point) => point.provider === "poketrace");
  assert.deepEqual(unavailable && {
    market: unavailable.market,
    grade: unavailable.grade,
    currency: unavailable.currency,
    sampleSize: unavailable.sampleSize,
    status: unavailable.status,
    reason: unavailable.reason,
  }, {
    market: "EU",
    grade: "RAW",
    currency: "GBP",
    sampleSize: 0,
    status: "unavailable",
    reason: "Provider unavailable for this market.",
  });
});

test("history metrics refuse thin, stale, short and single-source evidence", async () => {
  const thin = await readCardPriceHistory(historyDb([
    historyComp("thin", "2026-07-10T00:00:00.000Z", 1_000, { sampleSize: 2 }),
  ]), {
    cardId: "thin",
    grade: "RAW",
    now: new Date("2026-07-11T00:00:00.000Z"),
  });
  assert.equal(thin?.receipt?.metrics.liquidity.reason, "minimum-sample");
  assert.equal(thin?.receipt?.metrics.volatility.reason, "minimum-sample");
  assert.equal(thin?.receipt?.metrics.trend30Days.reason, "minimum-sample");

  const manualConflictRow = historyComp("manual_conflict", "2026-07-10T00:00:00.000Z", 1_000, {
    manualCheck: true,
    receipt: {
      all: [
        { source: "pokemon-price-tracker", grade: "RAW", currency: "GBP", medianPence: 1_000, sampleSize: 10, windowDays: 30, asOf: "2026-07-10T00:00:00.000Z" },
        { source: "checked-comps", grade: "RAW", currency: "GBP", medianPence: 1_500, sampleSize: 5, windowDays: 30, asOf: "2026-07-10T00:00:00.000Z", raw: { region: "UK" } },
      ],
    },
  });
  const manualConflict = await readCardPriceHistory(historyDb([manualConflictRow]), {
    cardId: "manual_conflict",
    grade: "RAW",
    now: new Date("2026-07-11T00:00:00.000Z"),
  });
  assert.equal(manualConflict?.receipt?.metrics.liquidity.status, "insufficient");
  assert.equal(manualConflict?.receipt?.metrics.sourceDisagreement.status, "available", "manual-check receipts must still explain the disagreement");
  assert.equal(manualConflict?.receipt?.metrics.sourceDisagreement.spreadPct, 40);

  const stale = await readCardPriceHistory(historyDb([
    historyComp("stale", "2026-05-12T00:00:00.000Z", 1_000),
  ]), {
    cardId: "stale",
    grade: "RAW",
    now: new Date("2026-07-11T00:00:00.000Z"),
  });
  assert.equal(stale?.receipt?.metrics.liquidity.reason, "stale-evidence");
  assert.equal(stale?.receipt?.metrics.volatility.reason, "stale-evidence");
  assert.equal(stale?.receipt?.metrics.trend30Days.reason, "stale-evidence");

  const tooFew = await readCardPriceHistory(historyDb([
    historyComp("few_1", "2026-06-20T00:00:00.000Z", 1_000),
    historyComp("few_2", "2026-07-01T00:00:00.000Z", 1_100),
    historyComp("few_3", "2026-07-10T00:00:00.000Z", 1_200),
  ]), {
    cardId: "few",
    grade: "RAW",
    now: new Date("2026-07-11T00:00:00.000Z"),
  });
  assert.equal(tooFew?.receipt?.metrics.volatility.reason, "minimum-observations");
  assert.equal(tooFew?.receipt?.metrics.sourceDisagreement.reason, "minimum-sources");

  const shortSpan = await readCardPriceHistory(historyDb([
    historyComp("short_1", "2026-07-01T00:00:00.000Z", 1_000),
    historyComp("short_2", "2026-07-04T00:00:00.000Z", 1_100),
    historyComp("short_3", "2026-07-07T00:00:00.000Z", 900),
    historyComp("short_4", "2026-07-10T00:00:00.000Z", 1_050),
  ]), {
    cardId: "short",
    grade: "RAW",
    now: new Date("2026-07-11T00:00:00.000Z"),
  });
  assert.equal(shortSpan?.receipt?.metrics.volatility.reason, "minimum-span");
});

test("history receipt bounds returned provenance without changing metric calculation", async () => {
  const now = new Date("2026-07-11T00:00:00.000Z");
  const rows = Array.from({ length: 260 }, (_, index) =>
    historyComp(`bounded_${index}`, new Date(now.getTime() - index * 3 * 60 * 60 * 1_000).toISOString(), 1_000 + index),
  );
  const history = await readCardPriceHistory(historyDb(rows), {
    cardId: "bounded",
    grade: "RAW",
    now,
  });
  assert.equal(history?.receipt?.evidence.length, 250);
  assert.equal(history?.receipt?.evidenceTruncated, true);
  assert.equal(history?.receipt?.metrics.volatility.status, "available");
});

type HistoryCompTestRow = Awaited<ReturnType<PriceHistoryDb["compResult"]["findMany"]>>[number];

function historyComp(
  id: string,
  asOf: string,
  medianPence: number,
  overrides: Partial<HistoryCompTestRow> = {},
): HistoryCompTestRow {
  return {
    id,
    grade: "RAW",
    asOf: new Date(asOf),
    createdAt: new Date(Date.parse(asOf) + 1_000),
    medianPence,
    source: "pokemon-price-tracker",
    currency: "GBP",
    sampleSize: 10,
    windowDays: 30,
    confidence: "high",
    manualCheck: false,
    receipt: null,
    ...overrides,
  };
}

function historyDb(rows: HistoryCompTestRow[]): PriceHistoryDb {
  return {
    card: {
      async findUnique() {
        return { id: "card_metrics", name: "Gengar", setName: "Lost Origin", number: "TG06/TG30", imageUrl: null, displayImageUrl: null };
      },
    },
    priceSnapshot: { async findMany() { return []; } },
    compResult: { async findMany() { return rows; } },
    inventoryItem: { async findMany() { return []; } },
  };
}
