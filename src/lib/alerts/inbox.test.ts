import { test } from "node:test";
import assert from "node:assert/strict";
import { alertAgeLabel, createInboxAlert, inboxUnreadCount, type AppAlertRow } from "./inbox.js";

test("createInboxAlert upserts by sourceKey and unread count ignores read rows", async () => {
  const db = fakeInboxDb();

  await createInboxAlert(db, {
    kind: "REPRICE",
    title: " Reprice stock ",
    message: "Drop to £12.00",
    pence: 1200,
    sourceKey: "reprice:item-1:1200",
  });
  await createInboxAlert(db, {
    kind: "REPRICE",
    title: "Reprice stock",
    message: "Drop to £11.00",
    pence: 1100,
    sourceKey: "reprice:item-1:1200",
  });

  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0]!.pence, 1100);
  assert.equal(inboxUnreadCount(db.rows), 1);

  db.rows[0]!.readAt = new Date("2026-07-03T12:00:00.000Z");
  assert.equal(inboxUnreadCount(db.rows), 0);
});

test("alertAgeLabel gives compact reader-facing ages", () => {
  const now = new Date("2026-07-03T12:00:00.000Z");
  assert.equal(alertAgeLabel("2026-07-03T11:55:00.000Z", now), "5m ago");
  assert.equal(alertAgeLabel("2026-07-03T10:00:00.000Z", now), "2h ago");
  assert.equal(alertAgeLabel("2026-07-01T12:00:00.000Z", now), "2d ago");
});

function fakeInboxDb() {
  const rows: AppAlertRow[] = [];
  return {
    rows,
    appAlert: {
      async findMany() {
        return rows;
      },
      async count() {
        return rows.length;
      },
      async create({ data }: { data: Omit<AppAlertRow, "id" | "readAt" | "createdAt"> & { readAt?: Date | null; createdAt?: Date } }) {
        const row = {
          id: `alert-${rows.length + 1}`,
          readAt: null,
          createdAt: new Date("2026-07-03T12:00:00.000Z"),
          ...data,
          sourceKey: data.sourceKey ?? null,
          href: data.href ?? null,
          pence: data.pence ?? null,
        };
        rows.push(row);
        return row;
      },
      async upsert({ where, create, update }: { where: { sourceKey: string }; create: any; update: any }) {
        const existing = rows.find((row) => row.sourceKey === where.sourceKey);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        return this.create({ data: create });
      },
      async updateMany() {
        return { count: 0 };
      },
    },
  };
}
