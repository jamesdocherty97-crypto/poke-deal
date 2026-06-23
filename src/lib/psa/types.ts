// PSA cert lookup domain types. Kept framework-free and money-free: a cert
// lookup verifies identity + grade + population, it is NOT a price. Pricing is
// done separately by feeding the resolved card+grade into the comp pipeline.

import type { Grade } from "../domain/types.js";

/** Normalized, app-facing result of a PSA cert verification. */
export interface PsaCertResult {
  /** True when the cert was found and parsed. */
  found: boolean;
  /** The cert number that was looked up (echoed back, trimmed). */
  certNumber: string;
  /** Card subject / name as PSA labels it, e.g. "UMBREON VMAX". */
  subject?: string;
  /** PSA "Brand" — usually the set/series, e.g. "POKEMON SWORD & SHIELD EVOLVING SKIES". */
  brand?: string;
  /** PSA category, e.g. "TCG CARDS". */
  category?: string;
  /** Printed year. */
  year?: string;
  /** Collector number as PSA records it, e.g. "215". */
  cardNumber?: string;
  /** Variety / parallel, e.g. "ALTERNATE ART SECRET". */
  variety?: string;
  /** Human grade label exactly as PSA returns it, e.g. "GEM MT 10". */
  gradeLabel?: string;
  /** Our canonical Grade if the label maps cleanly (e.g. "GEM MT 10" -> PSA_10), else null. */
  grade: Grade | null;
  /** Population at this grade. */
  totalPopulation?: number;
  /** Population graded higher than this card. */
  populationHigher?: number;
  /** Whether the slab carries a dual (card + auto) grade. */
  isDualCert?: boolean;
  /** Reason when found === false (missing token, invalid cert, no data, network error). */
  reason?: string;
  /** Whether this came from the live API (true) or bundled fixture (false). */
  live: boolean;
  /** Original payload, retained for debugging. Never relied on downstream. */
  raw?: unknown;
}

/**
 * Map a PSA "CardGrade"/"GradeDescription" label to our canonical Grade.
 * PSA labels look like "GEM MT 10", "MINT 9", "NM-MT 8", "PR 1". We take the
 * trailing numeric grade. Half grades and "AUTHENTIC" return null (kept as label).
 */
export function psaGradeLabelToGrade(label: string | undefined): Grade | null {
  if (!label) return null;
  const match = label.trim().match(/(\d{1,2})(?:\.\d)?\s*$/);
  if (!match) return null;
  const n = Number(match[1]);
  // Half grades (e.g. "9.5") are not representable in our PSA_x enum — keep label only.
  if (/\.\d\s*$/.test(label.trim())) return null;
  if (!Number.isInteger(n) || n < 1 || n > 10) return null;
  return `PSA_${n}` as Grade;
}
