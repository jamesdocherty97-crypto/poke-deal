import assert from "node:assert/strict";
import test from "node:test";
import type { ManualReviewDb } from "./manualReview.js";
import { listManualCompReviews, requestManualCompReview, resolveManualCompReview } from "./manualReview.js";

function reviewRow() {
  return {
    id: "comp_1",
    card: {
      id: "card_1",
      name: "Gengar",
      setName: "Lost Origin",
      number: "TG06/TG30",
      imageUrl: null,
      displayImageUrl: null,
    },
    grade: "RAW" as const,
    medianPence: 4200,
    source: "checked-comps",
    sampleSize: 7,
    windowDays: 90,
    asOf: new Date("2026-07-11T09:00:00.000Z"),
    confidence: "low",
    manualCheck: true,
    reasons: ["source-disagreement"],
    receipt: { all: [{ source: "checked-comps", sampleSize: 7 }] },
    createdAt: new Date("2026-07-11T09:01:00.000Z"),
    resolvedAt: null as Date | null,
    resolution: null as string | null,
    resolutionNote: null as string | null,
    reviewRequestedAt: new Date("2026-07-11T09:02:00.000Z") as Date | null,
    reviewExpiresAt: new Date("2099-08-10T09:02:00.000Z") as Date | null,
  };
}

function fakeDb() {
  const row = reviewRow();
  const db: ManualReviewDb = {
    compResult: {
      async findMany(args: any) {
        if (args.where.resolvedAt === null && row.resolvedAt) return [];
        return [row];
      },
      async findFirst() {
        return row;
      },
      async findUnique() {
        return row;
      },
      async updateMany(args: any) {
        if (row.resolvedAt || args.where.id !== row.id) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      },
    },
  };
  return { db, row };
}

test("manual review list returns full confidence and source evidence", async () => {
  const { db } = fakeDb();
  const result = await listManualCompReviews(db, { status: "open", limit: 20 });
  assert.equal(result.reviews.length, 1);
  assert.equal(result.reviews[0]?.headlinePence, 4200);
  assert.equal(result.reviews[0]?.sampleSize, 7);
  assert.equal(result.reviews[0]?.windowDays, 90);
  assert.deepEqual(result.reviews[0]?.reasons, ["source-disagreement"]);
  assert.deepEqual(result.reviews[0]?.receipt, { all: [{ source: "checked-comps", sampleSize: 7 }] });
});

test("manual review resolution updates metadata without mutating evidence", async () => {
  const { db, row } = fakeDb();
  const beforeReceipt = structuredClone(row.receipt);
  const result = await resolveManualCompReview(db, {
    id: "comp_1",
    resolution: "ACCEPT_HEADLINE",
    note: "Checked at the fair",
    now: new Date("2026-07-11T10:00:00.000Z"),
  });
  assert.equal(result.kind, "resolved");
  assert.equal(row.resolution, "ACCEPT_HEADLINE");
  assert.equal(row.resolvedAt?.toISOString(), "2026-07-11T10:00:00.000Z");
  assert.deepEqual(row.receipt, beforeReceipt);
});

test("repeating the same review resolution is idempotent but a different one conflicts", async () => {
  const { db } = fakeDb();
  const input = { id: "comp_1", resolution: "DISMISSED" as const, note: "Duplicate" };
  assert.equal((await resolveManualCompReview(db, input)).kind, "resolved");
  assert.equal((await resolveManualCompReview(db, input)).kind, "idempotent");
  assert.equal(
    (await resolveManualCompReview(db, { id: "comp_1", resolution: "ACCEPT_HEADLINE", note: "Duplicate" })).kind,
    "conflict",
  );
});

test("explicit review request refreshes one expiring task", async () => {
  const { db, row } = fakeDb();
  const now = new Date("2026-07-13T10:00:00.000Z");
  const result = await requestManualCompReview(db, { cardId: "card_1", grade: "RAW", now, ttlDays: 14 });
  assert.equal(result.kind, "requested");
  assert.equal(row.reviewRequestedAt?.toISOString(), now.toISOString());
  assert.equal(row.reviewExpiresAt?.toISOString(), "2026-07-27T10:00:00.000Z");
  assert.equal(row.resolvedAt, null);
});
