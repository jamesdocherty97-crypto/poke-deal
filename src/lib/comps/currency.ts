// The currency boundary. Every source converts to GBP pence here, at ingestion,
// so nothing downstream ever sees EUR/USD/JPY. Rates are pluggable: static
// defaults for dev, swap in a live FX fetch later behind the same shape.

import type { Currency } from "../domain/types.js";

/** Units of foreign currency per 1 GBP. (e.g. EUR: 1.17 means £1 = €1.17) */
export interface FxRates {
  asOf: string;
  /** GBP per 1 unit of the given currency. e.g. perGbp.EUR = how many EUR = £1 */
  perGbp: Record<Currency, number>;
}

/**
 * Static fallback rates. PLACEHOLDER values — fine for dev/fixture mode.
 * Replace with a live provider (see getRates) before trusting figures with money on them.
 */
export const STATIC_RATES: FxRates = {
  asOf: "2026-06-01",
  perGbp: {
    GBP: 1,
    EUR: 1.17, // £1 ≈ €1.17
    USD: 1.27, // £1 ≈ $1.27
    JPY: 192.0, // £1 ≈ ¥192
  },
};

/**
 * Convert an amount in `currency` to GBP pence (integer).
 * Rounds to the nearest penny; throws on unknown/zero rate so bad data fails loud.
 */
export function toGbpPence(
  amount: number,
  currency: Currency,
  rates: FxRates = STATIC_RATES,
): number {
  const perGbp = rates.perGbp[currency];
  if (!perGbp || perGbp <= 0) {
    throw new Error(`No FX rate for currency ${currency}`);
  }
  const gbp = amount / perGbp;
  return Math.round(gbp * 100);
}

/** Convenience: format GBP pence as a string like "£12.50". */
export function formatGbp(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}£${(abs / 100).toFixed(2)}`;
}

/**
 * Resolve current FX rates. v1 returns static rates; later, when FX_API_KEY is set,
 * fetch live and cache daily. Kept async now so callers don't change when it goes live.
 */
export async function getRates(): Promise<FxRates> {
  // TODO(codex): if process.env.FX_API_KEY, fetch live rates and cache for the day.
  return STATIC_RATES;
}
