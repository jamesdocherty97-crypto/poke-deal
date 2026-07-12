import assert from "node:assert/strict";
import test from "node:test";

import { buildQuickGradeOptions } from "./buyWorkspace.js";

test("buildQuickGradeOptions keeps the common buying grades compact", () => {
  assert.deepEqual(buildQuickGradeOptions("RAW"), ["RAW", "PSA_9", "PSA_10", "ACE_10"]);
});

test("buildQuickGradeOptions keeps the selected specialist grade visible", () => {
  assert.deepEqual(buildQuickGradeOptions("BGS_9_5"), ["BGS_9_5", "RAW", "PSA_9", "PSA_10", "ACE_10"]);
});

test("buildQuickGradeOptions never duplicates the selected grade", () => {
  const grades = buildQuickGradeOptions("PSA_10");

  assert.equal(grades.length, new Set(grades).size);
  assert.ok(grades.length <= 5);
});
