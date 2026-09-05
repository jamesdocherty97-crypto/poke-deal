import { test } from "node:test";
import assert from "node:assert/strict";
import { acquiredAtSchema, parseAcquisitionDate } from "./acquiredAt.js";

test("acquisition date preserves historical days and rejects impossible dates", () => {
  assert.equal(parseAcquisitionDate("2024-02-29"), "2024-02-29T12:00:00.000Z");
  assert.equal(parseAcquisitionDate("  "), undefined);
  for (const value of ["2025-02-29", "2026-02-30", "2026-13-01", "04/09/2026"]) {
    assert.throws(() => parseAcquisitionDate(value), /real date|YYYY-MM-DD/);
  }
});

test("API acquisition dates allow today at noon but never tomorrow", () => {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  assert.equal(acquiredAtSchema.safeParse(`${today}T12:00:00.000Z`).success, true);
  assert.equal(acquiredAtSchema.safeParse(`${tomorrow}T00:00:00.000Z`).success, false);
  assert.equal(acquiredAtSchema.safeParse("2026-02-30T12:00:00.000Z").success, false);
  assert.equal(acquiredAtSchema.safeParse(0).success, false);
});
