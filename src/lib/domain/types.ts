// Core domain types. Deliberately framework- and Prisma-free so the comp engine
// stays a pure, fast-to-test library. Money below the adapter boundary is ALWAYS
// GBP integer pence — never floats, never another currency.

export type Game = "POKEMON" | "SOCCER";
export type Language = "EN" | "JP";

export const GRADE_VALUES = [
  "RAW",
  "PSA_1", "PSA_2", "PSA_3", "PSA_4", "PSA_5",
  "PSA_6", "PSA_7", "PSA_8", "PSA_9", "PSA_10",
  "BGS_9", "BGS_9_5", "BGS_10",
  "CGC_1", "CGC_1_5", "CGC_2", "CGC_2_5", "CGC_3", "CGC_3_5", "CGC_4", "CGC_4_5",
  "CGC_5", "CGC_5_5", "CGC_6", "CGC_6_5", "CGC_7", "CGC_7_5", "CGC_8", "CGC_8_5",
  "CGC_9", "CGC_9_5", "CGC_10",
  "ACE_9", "ACE_10",
] as const;

export type Grade = (typeof GRADE_VALUES)[number];

export type Currency = "GBP" | "EUR" | "USD" | "JPY";

/** Lightweight reference to a card, enough for any adapter to resolve a lookup. */
export interface CardRef {
  id?: string;
  name: string;
  setName?: string;
  number?: string;
  tcgApiId?: string;
  game?: Game;
  language?: Language;
}

/** A single observed sale, as returned by a source BEFORE cleaning. */
export interface RawSale {
  /** Price in the sale's original currency (decimal, e.g. 12.50). */
  amount: number;
  currency: Currency;
  /** ISO timestamp of the sale. */
  soldAt: string;
  /** Listing title, used for lot/bundle detection. */
  title?: string;
  /** Grade as the source labelled it (e.g. "PSA 10", "Ungraded"). */
  gradeLabel?: string;
  /** Optional source-specific id for debugging. */
  externalId?: string;
}

/** A cleaned, GBP-normalized comp. Never a bare number — always carries confidence. */
export interface CompResult {
  source: string;
  card: CardRef;
  grade: Grade;
  currency: "GBP";
  medianPence: number;
  meanPence: number;
  lowPence: number;
  highPence: number;
  /** Number of sales that survived cleaning and back the figures above. */
  sampleSize: number;
  windowDays: number;
  /** % change of recent-half median vs older-half median. null if not enough data. */
  trendPct: number | null;
  outliersRemoved: number;
  asOf: string;
  /** Original payload, retained for debugging. Never relied on downstream. */
  raw?: unknown;
}

export interface CompQuery {
  grade?: Grade;
  /** Lookback window in days. Default 90. */
  windowDays?: number;
  /** Target display currency. Only GBP supported in v1 (the whole point). */
  currency?: "GBP";
}
