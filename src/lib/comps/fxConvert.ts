// Pure GBP conversion. No database, network, or framework imports.
// Live and cached rates stay in currency.ts.

import type { Currency } from "../domain/types.js";
import { roundHalfUpPence, type GbpPence } from "../format/money.js";

export const REQUIRED_QUOTES = ["GBP", "EUR", "USD", "JPY"] as const satisfies readonly Currency[];
export const FOREIGN_QUOTES = ["EUR", "USD", "JPY"] as const satisfies readonly Currency[];
export const DEFAULT_FX_PROVIDER = "exchangeratesapi";
export const FRESH_CACHE_DAYS = 1;
export const STALE_CACHE_MAX_DAYS = 7;

/** Units of foreign currency per 1 GBP. (e.g. EUR: 1.17 means £1 = €1.17) */
export interface FxRates {
  asOf: string;
  /** GBP per 1 unit of the given currency. e.g. perGbp.EUR = how many EUR = £1 */
  perGbp: Record<Currency, number>;
  source?: "live" | "cached" | "static";
  provider?: string;
  fetchedAt?: string;
  ageDays?: number | null;
  note?: string;
}

export type FxRateInfo = {
  source: "live" | "cached" | "static";
  provider: string;
  asOf: string;
  ageDays: number | null;
  note?: string;
};

/**
 * Static fallback rates. Placeholder values for dev and fixture mode.
 * getRates replaces them when a live provider or a fresh cache is available.
 */
export const STATIC_RATES: FxRates = {
  asOf: "2026-06-01",
  source: "static",
  provider: "static fallback",
  fetchedAt: "2026-06-01T00:00:00.000Z",
  ageDays: null,
  note: "static FX",
  perGbp: {
    GBP: 1,
    EUR: 1.17, // £1 ≈ €1.17
    USD: 1.27, // £1 ≈ $1.27
    JPY: 192.0, // £1 ≈ ¥192
  },
};

/**
 * Convert an amount in `currency` to integer GBP pence.
 * Converts before rounding and rounds half-up to the nearest penny.
 */
export function toGbpPence(
  amount: number,
  currency: Currency,
  rates: FxRates = STATIC_RATES,
): GbpPence {
  const perGbp = rates.perGbp[currency];
  if (!perGbp || perGbp <= 0) {
    throw new Error(`No FX rate for currency ${currency}`);
  }
  const gbp = amount / perGbp;
  return roundHalfUpPence(gbp);
}

export function fxRateInfo(rates: FxRates, now = new Date()): FxRateInfo {
  const ageDays = rates.source === "static" ? null : fxAgeDays(rates, now);
  return {
    source: rates.source ?? "static",
    provider: rates.provider ?? "unknown",
    asOf: rates.asOf,
    ageDays,
    note: rates.note,
  };
}

export function fxRateLabel(rates: FxRates, now = new Date()): string {
  const info = fxRateInfo(rates, now);
  if (info.source === "static") return "static FX";
  if (info.source === "live") return `live FX (${info.provider})`;
  return info.ageDays && info.ageDays > 0 ? `cached FX (${info.ageDays}d old)` : "cached FX";
}

export function hasStaticFxNote(rates: FxRates): boolean {
  return (rates.source ?? "static") === "static";
}

export function withRateMeta(
  rates: FxRates,
  source: NonNullable<FxRates["source"]>,
  now: Date,
  note?: string,
): FxRates {
  const ageDays = source === "static" ? null : fxAgeDays(rates, now);
  return {
    ...rates,
    source,
    provider: rates.provider ?? (source === "static" ? "static fallback" : DEFAULT_FX_PROVIDER),
    fetchedAt: rates.fetchedAt ?? now.toISOString(),
    ageDays: ageDays ?? undefined,
    note: note ?? (source === "static" ? "static FX" : undefined),
  };
}

export function fxAgeDays(rates: FxRates, now: Date): number {
  const asOf = Date.parse(rates.asOf);
  if (Number.isNaN(asOf)) return STALE_CACHE_MAX_DAYS + 1;
  return Math.max(0, Math.floor((startOfUtcDay(now).getTime() - startOfUtcDay(new Date(asOf)).getTime()) / 86_400_000));
}

export function parseFxPayload(payload: unknown, provider = DEFAULT_FX_PROVIDER, now = new Date()): FxRates {
  const root = payload as { base?: unknown; base_code?: unknown; date?: unknown; rates?: unknown; data?: unknown } | null;
  const base = String(root?.base ?? root?.base_code ?? "GBP").toUpperCase();
  if (base !== "GBP") throw new Error(`FX payload base ${base} is not GBP`);
  const values = (isRecord(root?.rates) ? root.rates : isRecord(root?.data) ? root.data : null) as Record<string, unknown> | null;
  if (!values) throw new Error("FX payload did not include rates");

  const perGbp = { GBP: 1 } as Record<Currency, number>;
  for (const quote of FOREIGN_QUOTES) {
    const rate = Number(values[quote]);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`FX payload missing ${quote}`);
    perGbp[quote] = rate;
  }

  const asOf = typeof root?.date === "string" && root.date.trim()
    ? startOfUtcDay(new Date(`${root.date.trim()}T00:00:00.000Z`)).toISOString()
    : startOfUtcDay(now).toISOString();

  return {
    asOf,
    perGbp,
    source: "live",
    provider,
    fetchedAt: now.toISOString(),
  };
}

export function readCurrency(value: unknown): Currency | null {
  return REQUIRED_QUOTES.includes(value as Currency) ? (value as Currency) : null;
}

export function dateKey(value: Date | string | undefined): string {
  const iso = toIso(value);
  return iso ? iso.slice(0, 10) : "unknown";
}

export function toIso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
