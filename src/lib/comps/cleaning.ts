// ─────────────────────────────────────────────────────────────
// The comp cleaning engine — the app's core IP.
//
// Turns a noisy pile of raw sales into one trustworthy, GBP-normalized comp:
//   match grade → drop lots/bundles → window → convert to GBP → strip outliers
//   → median/mean/range + sample size + trend.
//
// Pure & dependency-free: no DB, no network, no framework. Pass `now` and `rates`
// in so it is fully deterministic and testable. This is why it is hard to break.
// ─────────────────────────────────────────────────────────────

import type { CardRef, CompResult, Grade, RawSale } from "../domain/types.js";
import { STATIC_RATES, toGbpPence, type FxRates } from "./currency.js";

// ── Stats helpers (exported for tests) ───────────────────────

/** Sorted-array quantile via linear interpolation. q in [0,1]. */
export function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return quantile(s, 0.5);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ── Grade matching ───────────────────────────────────────────

/** Normalize a free-text grade label to a canonical Grade, or null if unrecognised. */
export function normalizeGradeLabel(label: string | undefined): Grade | null {
  if (label == null) return "RAW";
  const t = label.trim().toLowerCase();
  if (t === "") return "RAW";
  if (/\b(raw|ungraded|not graded|nm|near mint|loose)\b/.test(t)) return "RAW";

  const m = t.match(/\b(psa|bgs|cgc)\s*\.?\s*(10|9\.5|9|8|7|6|5|4|3|2|1)\b/);
  if (m) {
    const company = m[1]!.toUpperCase();
    const num = m[2]!.replace(".", "_");
    return `${company}_${num}` as Grade;
  }
  return null; // unrecognised — caller decides (we drop it)
}

/** Does a sale's labelled grade match the grade we're pricing? */
export function gradeMatches(target: Grade, saleLabel: string | undefined): boolean {
  const normalized = normalizeGradeLabel(saleLabel);
  return normalized === target;
}

// ── Lot / bundle detection ───────────────────────────────────

const LOT_PATTERNS: RegExp[] = [
  /\blot\b/,
  /\bbundle\b/,
  /\bjob\s*-?\s*lot\b/,
  /\bbulk\b/,
  /\bplayset\b/,
  /\bset of\b/,
  /\bcollection\b/,
  /\bjoblot\b/,
  /\bx\s?(\d{1,3})\b/, // "x4", "x 10"
  /\b(\d{1,3})\s?x\b/, // "4x"
  /\bread (description|desc)\b/,
  /\bproxy\b/,
  /\bcustom\b/,
  /\bdamaged\b/,
];

/** Heuristic: is this listing title a multi-card lot / not a clean single-card comp? */
export function isLotTitle(title: string | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return LOT_PATTERNS.some((re) => re.test(t));
}

// ── Outlier removal (IQR) ────────────────────────────────────

export interface OutlierResult {
  kept: number[];
  removed: number;
}

/**
 * Remove values outside [Q1 - k·IQR, Q3 + k·IQR]. With <4 points there isn't
 * enough signal to call outliers, so we keep everything.
 */
export function removeOutliersIQR(values: number[], k = 1.5): OutlierResult {
  if (values.length < 4) return { kept: [...values], removed: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - k * iqr;
  const hi = q3 + k * iqr;
  const kept = sorted.filter((v) => v >= lo && v <= hi);
  return { kept, removed: sorted.length - kept.length };
}

// ── The main entry point ─────────────────────────────────────

export interface CleanParams {
  source: string;
  card: CardRef;
  grade: Grade;
  sales: RawSale[];
  windowDays?: number;
  now?: Date;
  rates?: FxRates;
  /** Below this surviving sample size, treat the comp as low-confidence (still returned). */
  minSample?: number;
}

export const DEFAULT_WINDOW_DAYS = 90;
export const DEFAULT_MIN_SAMPLE = 3;

/**
 * Clean a set of raw sales into a single CompResult for the requested grade.
 * Always returns a result — sampleSize === 0 means "no usable comps", not an error.
 */
export function cleanToComp(params: CleanParams): CompResult {
  const {
    source,
    card,
    grade,
    sales,
    windowDays = DEFAULT_WINDOW_DAYS,
    now = new Date(),
    rates = STATIC_RATES,
  } = params;

  const windowStart = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  // 1. grade match  2. drop lots  3. window  4. → GBP pence  5. drop non-positive
  type Priced = { pence: number; at: number };
  const priced: Priced[] = [];
  for (const sale of sales) {
    if (!gradeMatches(grade, sale.gradeLabel)) continue;
    if (isLotTitle(sale.title)) continue;
    const at = Date.parse(sale.soldAt);
    if (Number.isNaN(at) || at < windowStart || at > now.getTime()) continue;
    let pence: number;
    try {
      pence = toGbpPence(sale.amount, sale.currency, rates);
    } catch {
      continue; // unknown currency — skip rather than poison the comp
    }
    if (pence <= 0) continue;
    priced.push({ pence, at });
  }

  // 6. outlier removal on price
  const { kept, removed } = removeOutliersIQR(priced.map((p) => p.pence));
  const keptSet = new Set<number>();
  // rebuild kept Priced rows preserving timestamps (match by value, allow dupes)
  const keptRows: Priced[] = [];
  const pool = [...priced];
  for (const v of kept) {
    const idx = pool.findIndex((p) => p.pence === v);
    if (idx >= 0) {
      keptRows.push(pool[idx]!);
      pool.splice(idx, 1);
      keptSet.add(v);
    }
  }

  const prices = keptRows.map((r) => r.pence);
  const asOf =
    keptRows.length > 0
      ? new Date(Math.max(...keptRows.map((r) => r.at))).toISOString()
      : now.toISOString();

  if (prices.length === 0) {
    return {
      source, card, grade, currency: "GBP",
      medianPence: 0, meanPence: 0, lowPence: 0, highPence: 0,
      sampleSize: 0, windowDays, trendPct: null, outliersRemoved: removed,
      asOf,
    };
  }

  return {
    source,
    card,
    grade,
    currency: "GBP",
    medianPence: Math.round(median(prices)),
    meanPence: Math.round(mean(prices)),
    lowPence: Math.min(...prices),
    highPence: Math.max(...prices),
    sampleSize: prices.length,
    windowDays,
    trendPct: computeTrend(keptRows, now, windowDays),
    outliersRemoved: removed,
    asOf,
  };
}

/** Recent-half median vs older-half median, as a %. null if either half is too thin. */
function computeTrend(
  rows: { pence: number; at: number }[],
  now: Date,
  windowDays: number,
): number | null {
  const mid = now.getTime() - (windowDays / 2) * 24 * 60 * 60 * 1000;
  const older = rows.filter((r) => r.at < mid).map((r) => r.pence);
  const recent = rows.filter((r) => r.at >= mid).map((r) => r.pence);
  if (older.length < 2 || recent.length < 2) return null;
  const o = median(older);
  const r = median(recent);
  if (o <= 0) return null;
  return Math.round(((r - o) / o) * 1000) / 10; // one decimal place
}

/** Is this comp trustworthy enough to act on? */
export function isConfident(result: CompResult, minSample = DEFAULT_MIN_SAMPLE): boolean {
  return result.sampleSize >= minSample;
}
