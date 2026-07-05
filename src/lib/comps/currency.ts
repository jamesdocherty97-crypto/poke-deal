// The currency boundary. Every source converts to GBP pence here, at ingestion,
// so nothing downstream ever sees EUR/USD/JPY. Live rates are cached daily when
// FX_API_KEY is configured; fixture/dev mode falls back honestly to static rates.

import type { Currency } from "../domain/types.js";
export { formatGbp } from "../format/money.js";

const REQUIRED_QUOTES = ["GBP", "EUR", "USD", "JPY"] as const satisfies readonly Currency[];
const FOREIGN_QUOTES = ["EUR", "USD", "JPY"] as const satisfies readonly Currency[];
const DEFAULT_PROVIDER = "exchangeratesapi";
const DEFAULT_FX_ENDPOINT = "https://api.exchangeratesapi.io/v1/latest";
const FRESH_CACHE_DAYS = 1;
const STALE_CACHE_MAX_DAYS = 7;

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

type FxRateRow = {
  quote: string;
  perGbp: number;
  asOf: Date | string;
  provider: string;
  fetchedAt?: Date | string;
};

type FxRateDelegate = {
  findMany(args?: unknown): Promise<FxRateRow[]>;
  createMany(args: { data: FxRateRow[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
};

export type FxRateDb = {
  fxRate: FxRateDelegate;
};

export type GetRatesOptions = {
  db?: FxRateDb | null;
  now?: Date;
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
};

/**
 * Static fallback rates. PLACEHOLDER values — fine for dev/fixture mode.
 * Replace with a live provider (see getRates) before trusting figures with money on them.
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
 * Convert an amount in `currency` to GBP pence (integer).
 * Converts before rounding and rounds half-up to the nearest penny.
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
  return roundHalfUpPence(gbp);
}

export function roundHalfUpPence(gbp: number): number {
  if (!Number.isFinite(gbp)) throw new Error("Cannot round a non-finite GBP amount");
  const sign = gbp < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(gbp) * 100 + 0.5 + 1e-9);
}

/**
 * Resolve current FX rates. Never throws for app callers: live fetch/cache when
 * configured, recent cache when the provider is unavailable, then static fallback.
 */
export async function getRates(options: GetRatesOptions = {}): Promise<FxRates> {
  const now = options.now ?? new Date();
  const db = options.db === undefined ? await defaultFxDb() : options.db;
  const cached = db ? await readCachedRates(db, now) : null;

  if (!options.forceRefresh && cached && fxAgeDays(cached, now) < FRESH_CACHE_DAYS) {
    return withRateMeta(cached, "cached", now);
  }

  const apiKey = options.apiKey ?? process.env.FX_API_KEY?.trim();
  if (apiKey) {
    try {
      const live = await fetchLiveRates({
        apiKey,
        endpoint: options.endpoint ?? process.env.FX_API_URL ?? DEFAULT_FX_ENDPOINT,
        fetchImpl: options.fetchImpl ?? fetch,
        now,
      });
      if (db) await cacheRates(db, live, now);
      return withRateMeta(live, "live", now);
    } catch (err) {
      console.warn(`[fx] live rate fetch failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  if (cached && fxAgeDays(cached, now) <= STALE_CACHE_MAX_DAYS) {
    return withRateMeta(cached, "cached", now, cached.ageDays && cached.ageDays > 0 ? `cached FX (${cached.ageDays}d old)` : "cached FX");
  }

  return withRateMeta(STATIC_RATES, "static", now, "static FX");
}

export async function getFxHealth(options: GetRatesOptions = {}): Promise<FxRateInfo> {
  return fxRateInfo(await getRates(options), options.now);
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

function withRateMeta(rates: FxRates, source: NonNullable<FxRates["source"]>, now: Date, note?: string): FxRates {
  const ageDays = source === "static" ? null : fxAgeDays(rates, now);
  return {
    ...rates,
    source,
    provider: rates.provider ?? (source === "static" ? "static fallback" : DEFAULT_PROVIDER),
    fetchedAt: rates.fetchedAt ?? now.toISOString(),
    ageDays: ageDays ?? undefined,
    note: note ?? (source === "static" ? "static FX" : undefined),
  };
}

function fxAgeDays(rates: FxRates, now: Date): number {
  const asOf = Date.parse(rates.asOf);
  if (Number.isNaN(asOf)) return STALE_CACHE_MAX_DAYS + 1;
  return Math.max(0, Math.floor((startOfUtcDay(now).getTime() - startOfUtcDay(new Date(asOf)).getTime()) / 86_400_000));
}

async function defaultFxDb(): Promise<FxRateDb | null> {
  if (!process.env.DATABASE_URL?.trim()) return null;
  try {
    const { getPrisma } = await import("../db/prisma.js");
    return getPrisma() as unknown as FxRateDb;
  } catch (err) {
    console.warn(`[fx] database unavailable for FX cache: ${err instanceof Error ? err.message : "unknown error"}`);
    return null;
  }
}

async function readCachedRates(db: FxRateDb, now: Date): Promise<FxRates | null> {
  const rows = await db.fxRate.findMany({
    where: { quote: { in: [...REQUIRED_QUOTES] } },
    orderBy: [{ asOf: "desc" }, { fetchedAt: "desc" }],
    take: 80,
  });
  const grouped = new Map<string, FxRateRow[]>();
  for (const row of rows) {
    const key = dateKey(row.asOf);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  for (const [key, group] of grouped) {
    const perGbp = { GBP: 1 } as Record<Currency, number>;
    for (const row of group) {
      const quote = readCurrency(row.quote);
      if (quote) perGbp[quote] = row.perGbp;
    }
    if (FOREIGN_QUOTES.every((quote) => Number.isFinite(perGbp[quote]) && perGbp[quote] > 0)) {
      const first = group[0]!;
      return withRateMeta(
        {
          asOf: startOfUtcDay(new Date(`${key}T00:00:00.000Z`)).toISOString(),
          perGbp,
          provider: first.provider,
          fetchedAt: toIso(first.fetchedAt) ?? toIso(first.asOf),
        },
        "cached",
        now,
      );
    }
  }
  return null;
}

async function cacheRates(db: FxRateDb, rates: FxRates, now: Date): Promise<void> {
  const asOf = startOfUtcDay(new Date(rates.asOf));
  const fetchedAt = now;
  await db.fxRate.createMany({
    data: REQUIRED_QUOTES.map((quote) => ({
      quote,
      perGbp: rates.perGbp[quote],
      asOf,
      provider: rates.provider ?? DEFAULT_PROVIDER,
      fetchedAt,
    })),
    skipDuplicates: true,
  });
}

async function fetchLiveRates({
  apiKey,
  endpoint,
  fetchImpl,
  now,
}: {
  apiKey: string;
  endpoint: string;
  fetchImpl: typeof fetch;
  now: Date;
}): Promise<FxRates> {
  const url = buildFxUrl(endpoint, apiKey);
  const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4500) });
  if (!res.ok) throw new Error(`provider returned HTTP ${res.status}`);
  const payload = (await res.json()) as unknown;
  return parseFxPayload(payload, providerName(url), now);
}

function buildFxUrl(endpoint: string, apiKey: string): string {
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase();
  if (host.includes("freecurrencyapi")) {
    if (!url.searchParams.has("apikey")) url.searchParams.set("apikey", apiKey);
    if (!url.searchParams.has("base_currency")) url.searchParams.set("base_currency", "GBP");
    if (!url.searchParams.has("currencies")) url.searchParams.set("currencies", FOREIGN_QUOTES.join(","));
    return url.toString();
  }

  if (!url.searchParams.has("access_key")) url.searchParams.set("access_key", apiKey);
  if (!url.searchParams.has("base")) url.searchParams.set("base", "GBP");
  if (!url.searchParams.has("symbols")) url.searchParams.set("symbols", FOREIGN_QUOTES.join(","));
  return url.toString();
}

export function parseFxPayload(payload: unknown, provider = DEFAULT_PROVIDER, now = new Date()): FxRates {
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

function readCurrency(value: unknown): Currency | null {
  return REQUIRED_QUOTES.includes(value as Currency) ? (value as Currency) : null;
}

function providerName(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("freecurrencyapi")) return "freecurrencyapi";
  if (host.includes("exchangerate")) return "exchangeratesapi";
  return DEFAULT_PROVIDER;
}

function dateKey(value: Date | string | undefined): string {
  const iso = toIso(value);
  return iso ? iso.slice(0, 10) : "unknown";
}

function toIso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
