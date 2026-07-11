import assert from "node:assert/strict";
import test from "node:test";
import { readSourceFreshness, recordSourceSuccess, resetSourceFreshnessForTests } from "./sourceFreshness.js";

test("source freshness reports last success without pretending unknown is fresh", () => {
  resetSourceFreshnessForTests();
  assert.deepEqual(readSourceFreshness("poketrace"), { lastSuccessAt: null, freshnessSeconds: null });
  recordSourceSuccess("poketrace", new Date("2026-07-11T10:00:00.000Z"));
  assert.deepEqual(readSourceFreshness("poketrace", new Date("2026-07-11T10:00:42.000Z")), {
    lastSuccessAt: "2026-07-11T10:00:00.000Z",
    freshnessSeconds: 42,
  });
});
