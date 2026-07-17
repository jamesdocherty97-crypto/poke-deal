import assert from "node:assert/strict";
import test from "node:test";
import { evaluateScanEvents, type ScanEvaluationRow } from "./scanEvaluation.js";

const now = new Date("2026-07-16T12:00:00.000Z");

function row(value: Partial<ScanEvaluationRow> & Pick<ScanEvaluationRow, "id" | "status">): ScanEvaluationRow {
  return {
    id: value.id,
    source: value.source ?? "gemini-scan",
    status: value.status,
    model: value.model ?? "gemini-3.1-flash-lite",
    latencyMs: value.latencyMs ?? 1_000,
    correctionOfId: value.correctionOfId ?? null,
    createdAt: value.createdAt ?? now,
  };
}

test("scan evaluation reports readable, correction and latency evidence without counting corrections as scans", () => {
  const summary = evaluateScanEvents([
    row({ id: "a", status: "READABLE", latencyMs: 100 }),
    row({ id: "b", status: "READABLE", latencyMs: 200 }),
    row({ id: "c", status: "UNREADABLE", latencyMs: 300 }),
    row({ id: "d", status: "ERROR", latencyMs: 400 }),
    row({ id: "fix-b", status: "CORRECTED", source: "dealer-correction", correctionOfId: "b" }),
  ], { now, periodDays: 30 });

  assert.equal(summary.total, 4);
  assert.equal(summary.readableRatePct, 66.7);
  assert.equal(summary.correctionRatePct, 50);
  assert.deepEqual(summary.latencyMs, { p50: 200, p95: 400 });
  assert.equal(summary.corrected, 1);
});

test("scan evaluation keeps per-model quality separate", () => {
  const summary = evaluateScanEvents([
    row({ id: "a", status: "READABLE", model: "model-a" }),
    row({ id: "b", status: "UNREADABLE", model: "model-a" }),
    row({ id: "c", status: "READABLE", model: "model-b" }),
    row({ id: "fix-c", status: "CORRECTED", source: "dealer-correction", correctionOfId: "c" }),
  ], { now });

  assert.deepEqual(summary.models, [
    { model: "model-a", scans: 2, readableRatePct: 50, correctionRatePct: 0 },
    { model: "model-b", scans: 1, readableRatePct: 100, correctionRatePct: 100 },
  ]);
});
