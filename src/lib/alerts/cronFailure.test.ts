import assert from "node:assert/strict";
import test from "node:test";
import { dispatchCronFailure } from "./cronFailure.js";
import type { AppAlertRow } from "./inbox.js";

test("cron failures create one inbox row and dispatch Discord once per source key", async () => {
  const rows: AppAlertRow[] = [];
  let notifications = 0;
  const db: any = {
    appAlert: {
      async create({ data }: any) {
        const row = { id: `alert-${rows.length + 1}`, readAt: null, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
      async upsert({ where, create, update }: any) {
        const row = rows.find((item) => item.sourceKey === where.sourceKey);
        if (row) { Object.assign(row, update); return row; }
        return this.create({ data: create });
      },
      async updateMany({ where, data }: any) {
        const matching = rows.filter((row) => (!where.id || row.id === where.id) && (where.delivered === undefined || row.delivered === where.delivered));
        matching.forEach((row) => Object.assign(row, data));
        return { count: matching.length };
      },
      async findMany() { return rows; },
      async count() { return rows.length; },
    },
  };
  const notifier = { async notify() { notifications += 1; } };
  const input = { title: "Daily job failed", message: "boom", sourceKey: "cron:daily:2026-07-11" };
  assert.equal((await dispatchCronFailure(db, input, { notifier, configured: true })).notified, true);
  assert.equal((await dispatchCronFailure(db, input, { notifier, configured: true })).deduplicated, true);
  assert.equal(rows.length, 1);
  assert.equal(notifications, 1);
});
