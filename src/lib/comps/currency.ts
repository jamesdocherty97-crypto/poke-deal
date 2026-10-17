// Live and cached FX. Pure conversion lives in fxConvert.ts so cleaning and
// other deterministic code do not import this module.

import { fetchReadWithRetry } from "../http/fetchReadWithRetry.js";
import {
  dateKey,
  DEFAULT_FX_PROVIDER,
  FOREIGN_QUOTES,
  FRESH_CACHE_DAYS,
  fxAgeDays,
  fxRateInfo,
  parseFxPayload,
  readCurrency,
  REQUIRED_QUOTES,
  startOfUtcDay,
  STATIC_RATES,
  STALE_CACHE_MAX_DAYS,
  toIso,
  withRateMeta,
  type FxRateInfo,
  type FxRates,
} from "./fxConvert.js";

const DEFAULT_FX_ENDPOINT = "https://api.exchangeratesapi.io/v1/latest";

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
    const perGbp = { GBP: 1 } as FxRates["perGbp"];
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
      provider: rates.provider ?? DEFAULT_FX_PROVIDER,
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
  const request = buildFxRequest(endpoint, apiKey);
  const res = await fetchReadWithRetry(fetchImpl, request.url, {
    headers: request.headers,
    signal: AbortSignal.timeout(4500),
  }, { totalDeadlineMs: 4500 });
  if (!res.ok) throw new Error(`provider returned HTTP ${res.status}`);
  const payload = (await res.json()) as unknown;
  return parseFxPayload(payload, providerName(request.url), now);
}

function buildFxRequest(endpoint: string, apiKey: string): { url: string; headers: Record<string, string> } {
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (host.includes("freecurrencyapi")) {
    // freecurrencyapi documents header auth and recommends it over the query
    // parameter because URLs are commonly retained in access logs and traces.
    url.searchParams.delete("apikey");
    headers.apikey = apiKey;
    if (!url.searchParams.has("base_currency")) url.searchParams.set("base_currency", "GBP");
    if (!url.searchParams.has("currencies")) url.searchParams.set("currencies", FOREIGN_QUOTES.join(","));
    return { url: url.toString(), headers };
  }

  if (!url.searchParams.has("access_key")) url.searchParams.set("access_key", apiKey);
  if (!url.searchParams.has("base")) url.searchParams.set("base", "GBP");
  if (!url.searchParams.has("symbols")) url.searchParams.set("symbols", FOREIGN_QUOTES.join(","));
  return { url: url.toString(), headers };
}

function providerName(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("freecurrencyapi")) return "freecurrencyapi";
  if (host.includes("exchangerate")) return "exchangeratesapi";
  return DEFAULT_FX_PROVIDER;
}
