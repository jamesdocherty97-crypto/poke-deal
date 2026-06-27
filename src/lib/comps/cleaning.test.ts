import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quantile,
  median,
  mean,
  normalizeGradeLabel,
  gradeMatches,
  isLotTitle,
  removeOutliersIQR,
  cleanToComp,
} from "./cleaning.js";
import { sampleRawSales } from "./sources/fixtures.js";

// Fixed clock so fixture dates are deterministic and inside the window.
const NOW = new Date("2026-06-21T12:00:00.000Z");

test("quantile interpolates", () => {
  const s = [10, 20, 30, 40];
  assert.equal(quantile(s, 0), 10);
  assert.equal(quantile(s, 1), 40);
  assert.equal(quantile(s, 0.5), 25);
});

test("median and mean", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(mean([2, 4, 6]), 4);
});

test("grade label normalization", () => {
  assert.equal(normalizeGradeLabel(undefined), "RAW");
  assert.equal(normalizeGradeLabel(""), "RAW");
  assert.equal(normalizeGradeLabel("Ungraded"), "RAW");
  assert.equal(normalizeGradeLabel("PSA 10"), "PSA_10");
  assert.equal(normalizeGradeLabel("PSA_10"), "PSA_10");
  assert.equal(normalizeGradeLabel("psa-10"), "PSA_10");
  assert.equal(normalizeGradeLabel("psa10"), "PSA_10");
  assert.equal(normalizeGradeLabel("BGS 9.5"), "BGS_9_5");
  assert.equal(normalizeGradeLabel("BGS_9_5"), "BGS_9_5");
  assert.equal(normalizeGradeLabel("BGS 7.5"), "BGS_7_5");
  assert.equal(normalizeGradeLabel("BGS_8_5"), "BGS_8_5");
  assert.equal(normalizeGradeLabel("CGC 1.5"), "CGC_1_5");
  assert.equal(normalizeGradeLabel("CGC_1_5"), "CGC_1_5");
  assert.equal(normalizeGradeLabel("cgc1.5"), "CGC_1_5");
  assert.equal(normalizeGradeLabel("CGC 10"), "CGC_10");
  assert.equal(normalizeGradeLabel("ACE 10"), "ACE_10");
  assert.equal(normalizeGradeLabel("ACE_10"), "ACE_10");
  assert.equal(normalizeGradeLabel("ace9"), "ACE_9");
  assert.equal(normalizeGradeLabel("PSA 1.5"), null);
  assert.equal(normalizeGradeLabel("totally unknown"), null);
});

test("grade matching", () => {
  assert.equal(gradeMatches("RAW", "Ungraded"), true);
  assert.equal(gradeMatches("PSA_10", "PSA 10"), true);
  assert.equal(gradeMatches("ACE_10", "ACE 10"), true);
  assert.equal(gradeMatches("RAW", "PSA 10"), false);
});

test("lot detection", () => {
  assert.equal(isLotTitle("Charizard ex 199/165 NM"), false);
  assert.equal(isLotTitle("Charizard x5 bundle"), true);
  assert.equal(isLotTitle("joblot of cards"), true);
  assert.equal(isLotTitle("set of 4 holos"), true);
  assert.equal(isLotTitle("Blastoise read description"), true);
  // must NOT false-positive on innocent words
  assert.equal(isLotTitle("Klefki padlock promo"), false);
});

test("IQR outlier removal keeps small samples intact", () => {
  assert.deepEqual(removeOutliersIQR([10, 20, 30]).kept.length, 3);
});

test("IQR strips extreme values", () => {
  const { kept, removed } = removeOutliersIQR([100, 105, 110, 108, 102, 5, 5000]);
  assert.ok(!kept.includes(5));
  assert.ok(!kept.includes(5000));
  assert.equal(removed, 2);
});

test("cleanToComp RAW: drops lot + wrong-grade + outliers, GBP-normalized", () => {
  const comp = cleanToComp({
    source: "test",
    card: { name: "Charizard ex", number: "199/165" },
    grade: "RAW",
    sales: sampleRawSales(NOW),
    now: NOW,
  });
  assert.equal(comp.currency, "GBP");
  assert.equal(comp.sampleSize, 8); // 10 raw priced, 2 outliers stripped
  assert.equal(comp.outliersRemoved, 2);
  assert.ok(comp.medianPence > 2700 && comp.medianPence < 2850, `median ${comp.medianPence}`);
  assert.ok(comp.lowPence >= 2268, "low fence respected");
  assert.ok(comp.highPence <= 3319, "high fence respected");
});

test("cleanToComp PSA_10: only slabs, foreign currency converted", () => {
  const comp = cleanToComp({
    source: "test",
    card: { name: "Charizard ex", number: "199/165" },
    grade: "PSA_10",
    sales: sampleRawSales(NOW),
    now: NOW,
  });
  assert.equal(comp.sampleSize, 5); // 6 PSA10, 1 low outlier (USD) stripped
  assert.equal(comp.outliersRemoved, 1);
  assert.ok(comp.medianPence > 14000 && comp.medianPence < 15000, `median ${comp.medianPence}`);
});

test("cleanToComp returns empty result, not error, when no comps", () => {
  const comp = cleanToComp({
    source: "test",
    card: { name: "Nonexistent" },
    grade: "BGS_10",
    sales: sampleRawSales(NOW),
    now: NOW,
  });
  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.equal(comp.trendPct, null);
});
