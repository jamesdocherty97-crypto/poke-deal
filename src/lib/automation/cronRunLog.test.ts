import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyRunKey, latestSuccessfulRun, runCronJobOnce, weeklyRunKey, type CronRunRow } from "./cronRunLog.js";

test("runCronJobOnce writes one successful run and skips a double fire", async () => {
  const db = fakeCronDb();
  let calls = 0;

  const first = await runCronJobOnce(db, {
    job: "daily-portfolio-snapshot",
    runKey: "2026-07-03",
    now: new Date("2026-07-03T07:30:00.000Z"),
    execute: async () => {
      calls += 1;
      return { written: 4 };
    },
  });
  const second = await runCronJobOnce(db, {
    job: "daily-portfolio-snapshot",
    runKey: "2026-07-03",
    execute: async () => {
      calls += 1;
      return { written: 4 };
    },
  });

  assert.equal(first.status, "SUCCESS");
  assert.equal(second.status, "SKIPPED");
  assert.equal(calls, 1);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0]!.status, "SUCCESS");
});

test("runCronJobOnce records failed runs for the inbox", async () => {
  const db = fakeCronDb();

  const result = await runCronJobOnce(db, {
    job: "daily-buy-watch-check",
    runKey: "2026-07-03",
    execute: async () => {
      throw new Error("source budget exhausted");
    },
  });

  assert.equal(result.status, "FAILED");
  assert.equal(db.rows[0]!.status, "FAILED");
  assert.equal(db.rows[0]!.error, "source budget exhausted");
});

test("run keys and latest successful run are deterministic", () => {
  assert.equal(dailyRunKey(new Date("2026-07-03T23:59:00.000Z")), "2026-07-03");
  assert.equal(weeklyRunKey(new Date("2026-07-03T12:00:00.000Z")), "2026-W27");

  const latest = latestSuccessfulRun(
    [
      cronRow({ id: "old", job: "daily-portfolio-snapshot", status: "SUCCESS", startedAt: new Date("2026-07-01T07:30:00.000Z") }),
      cronRow({ id: "failed", job: "daily-portfolio-snapshot", status: "FAILED", startedAt: new Date("2026-07-03T07:30:00.000Z") }),
      cronRow({ id: "new", job: "daily-portfolio-snapshot", status: "SUCCESS", startedAt: new Date("2026-07-02T07:30:00.000Z") }),
    ],
    "daily-portfolio-snapshot",
  );

  assert.equal(latest?.id, "new");
});

function fakeCronDb() {
  const rows: CronRunRow[] = [];
  return {
    rows,
    cronRun: {
      async findUnique({ where }: { where: { job_runKey: { job: string; runKey: string } } }) {
        return rows.find((row) => row.job === where.job_runKey.job && row.runKey === where.job_runKey.runKey) ?? null;
      },
      async findMany() {
        return rows;
      },
      async create({ data }: { data: { job: string; runKey: string; status: CronRunRow["status"]; startedAt: Date } }) {
        const row = cronRow({ ...data, id: `run-${rows.length + 1}` });
        rows.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<CronRunRow> }) {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error("missing row");
        Object.assign(row, data);
        return row;
      },
    },
  };
}

function cronRow(input: Partial<CronRunRow> & { id: string }): CronRunRow {
  return {
    job: "job",
    runKey: "key",
    status: "RUNNING",
    startedAt: new Date("2026-07-03T07:30:00.000Z"),
    finishedAt: null,
    details: null,
    error: null,
    ...input,
  };
}
