import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../app/api/system/status/route.js";

test("paused schedules are informational even when historical cron runs succeeded", async () => {
  const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globalDb.prisma;
  const previousEnv = process.env;
  const previousFetch = globalThis.fetch;
  process.env = { NODE_ENV: "test", DATABASE_URL: "postgresql://unused-local-test" };
  globalThis.fetch = async () => { throw new Error("Status must not contact a provider in this test"); };
  globalDb.prisma = {
    fxRate: { async findMany() { return []; } },
    scanEvent: { async findMany() { return []; } },
    cronRun: { async findMany() { return [{
      id: "run-1", job: "daily-portfolio-snapshot", runKey: "2026-09-01",
      status: "SUCCESS", startedAt: new Date("2026-09-01T07:30:00Z"),
      finishedAt: new Date("2026-09-01T07:30:10Z"), details: {}, error: null,
    }]; } },
  };
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    const payload = await response.json();
    const automation = payload.sources.find((source: any) => source.id === "automation");
    assert.equal(automation.status, "info");
    assert.equal(automation.required, false);
    assert.match(automation.setupHint, /Scheduled checks are paused/);
    assert.match(automation.setupHint, /eBay order sync/);
    assert.equal(payload.summary.lastSnapshotAt, "2026-09-01T07:30:00.000Z");
  } finally {
    globalDb.prisma = previousDb;
    process.env = previousEnv;
    globalThis.fetch = previousFetch;
  }
});
