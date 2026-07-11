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
          asOf: new Date("2026-07-10T00:00:00.000Z"),
          createdAt: new Date("2026-07-10T00:00:01.000Z"),
          medianPence: 4200,
          source: "checked-comps",
          sampleSize: 7,
          windowDays: 90,
          confidence: "medium",
          manualCheck: false,
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
