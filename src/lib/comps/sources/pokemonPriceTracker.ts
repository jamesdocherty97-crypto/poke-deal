// Reference adapter: Pokemon Price Tracker (primary comp source), API v2.
//
// Runs in two modes:
//   • FIXTURE (no API key) → bundled sample sales cleaned by cleanToComp. App works offline.
//   • LIVE   (key present) → GET /api/v2/cards?includeEbay=true. The provider returns
//     PRE-AGGREGATED stats per grade (count, median/avg/min/max, trend, a filtered
//     "smartMarketPrice"), NOT individual sales — so we map the aggregate straight to a
//     CompResult instead of fabricating raw sales. Prices are USD → converted to GBP.
//
// Verified against the live v2 response on 2026-06-22 (see __fixtures__/ppt-cards-ebay.json).
// Grade sales (incl. "ungraded" = RAW) live at: data[0].ebay.salesByGrade[<providerKey>]
// in current live responses; the mapper also accepts the older object-shaped data fixture.

import type { CardRef, CompQuery, CompResult, Grade } from "../../domain/types.js";
import { getSetById, resolveSetIdForCard } from "../../catalog/setCatalog.js";
import type { CompSource } from "../CompSource.js";
import { cleanToComp, DEFAULT_WINDOW_DAYS } from "../cleaning.js";
import { STATIC_RATES, toGbpPence, type FxRates } from "../currency.js";
import { sampleRawSales } from "./fixtures.js";

const BASE_URL = "https://www.pokemonpricetracker.com/api/v2";
const DEFAULT_FETCH_TIMEOUT_MS = 6500;

export class PokemonPriceTrackerSource implements CompSource {
  readonly name = "pokemon-price-tracker";
  readonly live: boolean;

  constructor(
    private readonly apiKey: string | undefined = process.env.POKEMON_PRICE_TRACKER_API_KEY,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  ) {
    this.live = Boolean(apiKey && apiKey.trim().length > 0);
  }

  async lookup(card: CardRef, query: CompQuery = {}): Promise<CompResult> {
    const grade: Grade = query.grade ?? "RAW";
    const windowDays = query.windowDays ?? DEFAULT_WINDOW_DAYS;

    if (!this.live) {
      // Offline: clean bundled individual sales. Exercises the cleaning engine.
      return cleanToComp({
        source: this.name,
        card,
        grade,
        sales: sampleRawSales(),
        windowDays,
        rates: STATIC_RATES,
      });
    }

    const json = await this.fetchCard(card, windowDays);
    if (json == null) {
      return emptyComp({ source: this.name, card, grade, windowDays }, "Price Tracker lookup failed or returned no response");
    }
    return mapCardAggregateToComp(json, { source: this.name, card, grade, windowDays });
  }

  /** Fetch one card with eBay graded-sales aggregates. Returns null on any failure. */
  private async fetchCard(card: CardRef, windowDays: number): Promise<unknown | null> {
    // BILLING: credits are charged on the requested `limit` (default 50!) — pass limit=1.
    const days = Math.min(Math.max(windowDays, 1), 180); // Pro plan caps history at 180d
    const search = buildPokemonPriceTrackerSearch(card);
    const params = new URLSearchParams({
      language: "english",
      search,
      includeEbay: "true",
      days: String(days),
      limit: "1",
    });
    if (card.setName) params.set("set", card.setName);

    try {
      const res = await this.fetchImpl(`${BASE_URL}/cards?${params.toString()}`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        signal: timeoutSignal(this.fetchTimeoutMs),
      });
      if (!res.ok) {
        console.warn(`[${this.name}] HTTP ${res.status} — no comp returned`);
        return null;
      }
      return (await res.json()) as unknown;
    } catch (err) {
      // Degrade, don't explode: a dead provider must not break a lookup.
      console.warn(`[${this.name}] fetch failed: ${(err as Error).message}`);
      return null;
    }
  }
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
}

// ── Pure mapping (exported for fixture tests) ────────────────────────────────

interface MapContext {
  source: string;
  card: CardRef;
  grade: Grade;
  windowDays: number;
}

/** Map our Grade to the provider's salesByGrade key. RAW → "ungraded". */
export function gradeToProviderKey(grade: Grade): string {
  if (grade === "RAW") return "ungraded";
  const parts = grade.split("_"); // e.g. ["BGS","9","5"] or ["PSA","10"]
  const company = parts[0]!.toLowerCase();
  const num = parts.slice(1).join("_"); // "9_5", "10", "9"
  return `${company}${num}`; // "bgs9_5", "psa10", "psa9"
}

export function buildPokemonPriceTrackerSearch(card: CardRef): string {
  const number = normalizeProviderCollectorNumber(card.number, card.setName);
  return [card.name, number].filter(Boolean).join(" ");
}

export function normalizeProviderCollectorNumber(
  number: string | undefined,
  setName: string | undefined,
): string | undefined {
  const trimmed = number?.trim();
  if (!trimmed) return undefined;

  const [left, right] = trimmed.split("/").map((part) => part.trim());
  const prefix = readPrefixedCollectorPrefix(left);
  if (!prefix) return trimmed;
  if (!shouldMirrorProviderPrefix(prefix, setName)) return trimmed;

  if (right) {
    return /^\d+$/.test(right) ? `${left}/${prefix}${right}` : `${left}/${right}`;
  }

  const setId = resolveSetIdForCard(setName, left);
  const set = setId ? getSetById(setId) : undefined;
  return set?.printedTotal ? `${left}/${prefix}${set.printedTotal}` : left;
}

function shouldMirrorProviderPrefix(prefix: string, setName: string | undefined): boolean {
  const normalizedSet = setName?.toLowerCase() ?? "";
  return (
    ["TG", "GG", "SV", "RC"].includes(prefix) ||
    normalizedSet.includes("trainer gallery") ||
    normalizedSet.includes("galarian gallery") ||
    normalizedSet.includes("shiny vault") ||
    normalizedSet.includes("radiant collection")
  );
}

function readPrefixedCollectorPrefix(value: string | undefined): string | null {
  const match = value?.match(/^([A-Za-z]{1,4})\d+$/);
  return match?.[1]?.toUpperCase() ?? null;
}

function emptyComp(ctx: MapContext, reason = "no Price Tracker data"): CompResult {
  return {
    source: ctx.source,
    card: ctx.card,
    grade: ctx.grade,
    currency: "GBP",
    medianPence: 0,
    meanPence: 0,
    lowPence: 0,
    highPence: 0,
    sampleSize: 0,
    windowDays: ctx.windowDays,
    trendPct: null,
    outliersRemoved: 0,
    asOf: new Date().toISOString(),
    raw: { reason },
  };
}

/**
 * Convert the v2 /cards (includeEbay) payload into a CompResult for the requested grade.
 * The provider pre-aggregates, so we pass its stats through (USD → GBP). Never throws for
 * "no data" — returns sampleSize 0. RAW uses the provider's filtered smartMarketPrice
 * when present because the broad ungraded eBay bucket is noisy.
 */
export function mapCardAggregateToComp(
  json: unknown,
  ctx: MapContext,
  rates: FxRates = STATIC_RATES,
): CompResult {
  const root = json as { data?: unknown } | null;
  const card = (Array.isArray(root?.data) ? root!.data[0] : root?.data) as
    | { ebay?: { salesByGrade?: Record<string, unknown>; updatedAt?: string } }
    | undefined;

  const byGrade = card?.ebay?.salesByGrade;
  if (!byGrade) return emptyComp(ctx, "no eBay grade aggregate returned");

  const agg = byGrade[gradeToProviderKey(ctx.grade)] as
    | {
        count?: number;
        averagePrice?: number;
        medianPrice?: number;
        minPrice?: number;
        maxPrice?: number;
        smartMarketPrice?: { price?: number; confidence?: string; method?: string; daysUsed?: number };
        lastMarketUpdate?: string;
      }
    | undefined;

  const count = Number(agg?.count ?? 0);
  if (!agg || !Number.isFinite(count) || count <= 0) {
    return emptyComp(ctx, `no ${ctx.grade.replace(/_/g, " ")} eBay aggregate`);
  }

  const usdToPence = (usd: unknown): number => {
    const n = Number(usd);
    return Number.isFinite(n) && n > 0 ? toGbpPence(n, "USD", rates) : 0;
  };

  const smartRawPrice =
    ctx.grade === "RAW" && Number.isFinite(Number(agg.smartMarketPrice?.price))
      ? Number(agg.smartMarketPrice?.price)
      : null;
  const chosenMedianUsd = smartRawPrice && smartRawPrice > 0 ? smartRawPrice : agg.medianPrice;

  return {
    source: ctx.source,
    card: ctx.card,
    grade: ctx.grade,
    currency: "GBP",
    medianPence: usdToPence(chosenMedianUsd),
    meanPence: usdToPence(agg.averagePrice),
    lowPence: usdToPence(agg.minPrice),
    highPence: usdToPence(agg.maxPrice),
    sampleSize: Math.round(count),
    windowDays: ctx.windowDays,
    // Provider only exposes a "up"/"down" marketTrend, not a %. Kept honest as null;
    // a real % can be derived from ebay.priceHistory later.
    trendPct: null,
    outliersRemoved: 0, // provider applies its own filtering (smartMarketPrice)
    asOf: String(agg.lastMarketUpdate ?? card?.ebay?.updatedAt ?? new Date().toISOString()),
    raw: {
      ...agg,
      chosenPriceSource: smartRawPrice ? "smartMarketPrice" : "medianPrice",
    },
  };
}
