// Reference adapter: Pokemon Price Tracker (primary comp source), API v2.
//
// Missing credentials return explicit unavailable evidence. Captured fixtures are
// used only by tests and must never become dealer-facing prices.
// With a key, GET /api/v2/cards?includeEbay=true. The provider returns
//     PRE-AGGREGATED stats per grade (count, median/avg/min/max, trend, a filtered
//     "smartMarketPrice"), NOT individual sales — so we map the aggregate straight to a
//     CompResult instead of fabricating raw sales. Prices are USD → converted to GBP.
//
// Verified against the live v2 response on 2026-06-22 (see __fixtures__/ppt-cards-ebay.json).
// Grade sales (incl. "ungraded" = RAW) live at: data[0].ebay.salesByGrade[<providerKey>]
// in current live responses; the mapper also accepts the older object-shaped data fixture.

import { GRADE_VALUES, type CardRef, type CompQuery, type CompResult, type Grade } from "../../domain/types.js";
import { getSetById, resolveSetIdForCard } from "../../catalog/setCatalog.js";
import { normalizeSearchText, tokenMatches, tokenizeSearchText } from "../../catalog/fuzzy.js";
import {
  collectorNumbersEquivalent,
  normalizeCollectorNumberForCompare,
  stripLeadingZerosFromNumericSegment,
  stripProviderSetCodePrefix,
} from "../../cards/identity.js";
import type { CompSource, CompSourceContext } from "../CompSource.js";
import { createAbortScope } from "../../http/abortScope.js";
import { DEFAULT_WINDOW_DAYS } from "../cleaning.js";
import { fxRateInfo, getRates, STATIC_RATES, toGbpPence, type FxRates } from "../currency.js";
import { detectCardPrintIdentity, requestsFirstEdition, textMentionsFirstEdition } from "../variants.js";
import { fetchReadWithRetry } from "../../http/fetchReadWithRetry.js";

const BASE_URL = "https://www.pokemonpricetracker.com/api/v2";
const DEFAULT_FETCH_TIMEOUT_MS = 6500;
const LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedPptLookup = {
  value: unknown;
  cachedAt: number;
  expiresAt: number;
};

type PptRead = { value: unknown; cache: { state: "live" | "cached"; retrievedAt: string; cachedAt?: string; expiresAt: string; ageMinutes: number } };

const lookupCache = new Map<string, CachedPptLookup>();

export function resetPokemonPriceTrackerCacheForTests(): void {
  lookupCache.clear();
}

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

  async lookup(card: CardRef, query: CompQuery = {}, context: CompSourceContext = {}): Promise<CompResult> {
    const grade: Grade = query.grade ?? "RAW";
    const windowDays = query.windowDays ?? DEFAULT_WINDOW_DAYS;

    if (!this.live) {
      return emptyComp({ source: this.name, card, grade, windowDays }, "Price Tracker key missing");
    }

    const read = await this.fetchCard(card, windowDays, grade, context.signal);
    if (read == null) {
      return emptyComp({ source: this.name, card, grade, windowDays }, "Price Tracker lookup failed or returned no response");
    }
    const rates = await getRates();
    const mapped = mapCardAggregateToComp(read.value, { source: this.name, card, grade, windowDays }, rates);
    return { ...mapped, raw: { ...(mapped.raw as Record<string, unknown>), cache: read.cache } };
  }

  /** Fetch one card with eBay graded-sales aggregates. Returns null on any failure. */
  private async fetchCard(card: CardRef, windowDays: number, grade: Grade, parentSignal?: AbortSignal): Promise<PptRead | null> {
    // BILLING: credits are charged on the requested `limit` (default 50!) — pass limit=1.
    const days = Math.min(Math.max(windowDays, 1), 180); // Pro plan caps history at 180d
    const search = buildPokemonPriceTrackerSearch(card);
    const attempts = buildFetchAttempts(card, search, days);
    const cacheKey = buildLookupCacheKey(card, days);
    const cached = readLookupCache(cacheKey);
    if (cached) {
      return providerHasGradeAggregate(cached.value, grade) ? {
        value: cached.value,
        cache: {
          state: "cached",
          retrievedAt: new Date(cached.cachedAt).toISOString(),
          cachedAt: new Date(cached.cachedAt).toISOString(),
          expiresAt: new Date(cached.expiresAt).toISOString(),
          ageMinutes: Math.max(0, Math.floor((Date.now() - cached.cachedAt) / 60_000)),
        },
      } : null;
    }

    let matchedWithoutGrade: unknown | null = null;
    const rounds = grade === "RAW" ? 1 : 2;
    for (let round = 0; round < rounds; round += 1) {
      for (const params of attempts) {
        const abort = createAbortScope(parentSignal, this.fetchTimeoutMs);
        try {
          const res = await fetchReadWithRetry(this.fetchImpl, `${BASE_URL}/cards?${params.toString()}`, {
            headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
            signal: abort.signal,
          }, { totalDeadlineMs: this.fetchTimeoutMs });
          if (!res.ok) {
            console.warn(`[${this.name}] HTTP ${res.status} — no comp returned`);
            continue;
          }
          const json = (await res.json()) as unknown;
          const match = selectMatchingPptCard(json, card);
          if (match) {
            if (providerHasGradeAggregate(match, grade)) {
              const entry = writeLookupCache(cacheKey, match);
              return {
                value: match,
                cache: { state: "live", retrievedAt: new Date(entry.cachedAt).toISOString(), expiresAt: new Date(entry.expiresAt).toISOString(), ageMinutes: 0 },
              };
            }
            matchedWithoutGrade = match;
            continue;
          }
          console.warn(`[${this.name}] returned a different card for ${search} — retrying/falling back`);
        } catch (err) {
          // Degrade, don't explode: a dead provider must not break a lookup.
          console.warn(`[${this.name}] fetch failed: ${(err as Error).message}`);
          if (parentSignal?.aborted) return null;
        } finally {
          abort.cleanup();
        }
      }
      if (round < rounds - 1 && !parentSignal?.aborted) await sleep(350);
    }

    return matchedWithoutGrade ? {
      value: matchedWithoutGrade,
      cache: { state: "live", retrievedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + LOOKUP_CACHE_TTL_MS).toISOString(), ageMinutes: 0 },
    } : null;
  }
}

function buildLookupCacheKey(card: CardRef, days: number): string {
  const setName = normalizeSearchText(card.setName ?? "");
  const number = normalizeProviderCollectorNumber(card.number, card.setName) ?? "";
  return `${normalizeSearchText(card.name)}|${setName}|${number}|${days}`;
}

function readLookupCache(key: string): CachedPptLookup | null {
  const cached = lookupCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    lookupCache.delete(key);
    return null;
  }
  return cached;
}

function writeLookupCache(key: string, value: unknown): CachedPptLookup {
  const cachedAt = Date.now();
  const entry = { value, cachedAt, expiresAt: cachedAt + LOOKUP_CACHE_TTL_MS };
  lookupCache.set(key, entry);
  return entry;
}

function providerHasGradeAggregate(json: unknown, grade: Grade): boolean {
  const card = readProviderCard(json);
  const agg = card?.ebay?.salesByGrade?.[gradeToProviderKey(grade)] as { count?: unknown; medianPrice?: unknown } | undefined;
  const count = Number(agg?.count ?? 0);
  return Boolean(agg && Number.isFinite(count) && count > 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Pure mapping (exported for fixture tests) ────────────────────────────────

interface MapContext {
  source: string;
  card: CardRef;
  grade: Grade;
  windowDays: number;
}

interface PptProviderCard {
  ebay?: { salesByGrade?: Record<string, unknown>; updatedAt?: string };
  prices?: Record<string, unknown>;
  name?: unknown;
  number?: unknown;
  cardNumber?: unknown;
  collectorNumber?: unknown;
  setName?: unknown;
  set?: unknown;
  [key: string]: unknown;
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

function buildFetchAttempts(card: CardRef, search: string, days: number): URLSearchParams[] {
  const base = {
    language: "english",
    includeEbay: "true",
    days: String(days),
    limit: "1",
  };
  const attempts: URLSearchParams[] = [];

  const withSet = new URLSearchParams({ ...base, search });
  if (card.setName) withSet.set("set", card.setName);
  attempts.push(withSet);

  if (card.setName) {
    attempts.push(new URLSearchParams({ ...base, search }));
  }

  const fallbackSearches = buildPokemonPriceTrackerSearchVariants(card).filter((variant) => variant !== search);
  for (const fallbackSearch of fallbackSearches) {
    const fallbackWithSet = new URLSearchParams({ ...base, search: fallbackSearch });
    if (card.setName) fallbackWithSet.set("set", card.setName);
    attempts.push(fallbackWithSet);

    if (card.setName && fallbackSearch !== card.name.trim()) {
      attempts.push(new URLSearchParams({ ...base, search: fallbackSearch }));
    }
  }

  return attempts;
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

export function buildPokemonPriceTrackerSearchVariants(card: CardRef): string[] {
  const variants = [buildPokemonPriceTrackerSearch(card)];
  const variantNumbers = buildProviderCollectorNumberVariants(card.number, card.setName);
  for (const variant of variantNumbers) {
    const variantWithName = [card.name, variant].filter(Boolean).join(" ");
    if (variantWithName) variants.push(variantWithName);
    const left = variant.split("/")[0]?.trim();
    if (left) variants.push([card.name, left].filter(Boolean).join(" "));
  }
  variants.push(card.name.trim());
  return [...new Set(variants.filter((variant) => variant.trim().length > 0))];
}

function buildProviderCollectorNumberVariants(number: string | undefined, setName: string | undefined): string[] {
  const normalized = normalizeProviderCollectorNumber(number, setName);
  if (!normalized) return [];

  const variants = [normalized];
  const [leftPart, rightPart] = normalized.split("/");
  const trimmedLeft = leftPart?.trim();
  if (trimmedLeft) {
    const unpaddedLeft = stripLeadingZerosFromNumericSegment(trimmedLeft);
    if (unpaddedLeft && unpaddedLeft !== trimmedLeft) {
      const strippedPrefix = /^([A-Za-z]{2,5})(\d+)$/.exec(trimmedLeft);
      if (strippedPrefix?.[1]) {
        variants.push(`${strippedPrefix[1]}${unpaddedLeft}`);
      } else {
        variants.push(unpaddedLeft);
      }
      if (rightPart) variants.push(`${unpaddedLeft}/${rightPart}`);
    }
  }

  if (!trimmedLeft || !rightPart?.trim()) return variants;

  const paddedLeft = padWithLeadingZeros(trimmedLeft, 3);
  if (paddedLeft && paddedLeft !== trimmedLeft) {
    variants.push(`${paddedLeft}/${rightPart}`);
  }

  const extraPadded = padWithLeadingZeros(trimmedLeft, rightPart.length);
  if (extraPadded && extraPadded !== paddedLeft && extraPadded !== trimmedLeft) {
    variants.push(`${extraPadded}/${rightPart}`);
  }

  return [...new Set(variants)];
}

function padWithLeadingZeros(value: string, minLength: number): string {
  if (!/^\d+$/.test(value)) return value;
  const targetLength = Math.max(3, minLength);
  const withPad = value.padStart(targetLength, "0");
  return withPad !== value ? withPad : value;
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
  const card = readProviderCard(json);

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
        marketPrice7Day?: number | null;
        marketPriceMedian7Day?: number | null;
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
  const trendPct = estimateTrendPct(card?.prices, agg);

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
    trendPct,
    outliersRemoved: 0, // provider applies its own filtering (smartMarketPrice)
    asOf: String(agg.lastMarketUpdate ?? card?.ebay?.updatedAt ?? new Date().toISOString()),
    raw: {
      ...agg,
      fx: fxRateInfo(rates),
      prices: card?.prices,
      displayImageUrl: readProviderImageUrl(card),
      providerCard: providerCardRef(card),
      chosenPriceSource: smartRawPrice ? "smartMarketPrice" : "medianPrice",
      // Full grade ladder from this same single response — no extra credits.
      gradeLadder: buildGradeLadder(json, rates),
    },
  };
}

export interface GradeLadderRow {
  grade: Grade;
  providerKey: string;
  medianPence: number;
  sampleSize: number;
  source: string;
}

/**
 * Project every grade present in a SINGLE PPT /cards (includeEbay) response into
 * a price ladder: RAW + each PSA/BGS/CGC bucket the provider returned, each with
 * its own median (GBP pence) and sample size. The whole salesByGrade block ships
 * in one response, so this costs zero extra API credits — it just surfaces data
 * the headline lookup already paid for and discarded. RAW uses the provider's
 * filtered smartMarketPrice (the broad ungraded eBay bucket is noisy), mirroring
 * mapCardAggregateToComp so the ladder's RAW row matches the RAW headline.
 */
export function buildGradeLadder(json: unknown, rates: FxRates = STATIC_RATES): GradeLadderRow[] {
  const card = readProviderCard(json);
  const byGrade = card?.ebay?.salesByGrade;
  if (!byGrade || typeof byGrade !== "object") return [];

  const rows: GradeLadderRow[] = [];
  for (const grade of GRADE_VALUES) {
    const providerKey = gradeToProviderKey(grade);
    const agg = (byGrade as Record<string, unknown>)[providerKey] as
      | { count?: number; medianPrice?: number; smartMarketPrice?: { price?: number } }
      | undefined;
    if (!agg) continue;

    const count = Number(agg.count ?? 0);
    if (!Number.isFinite(count) || count <= 0) continue;

    const smartRaw =
      grade === "RAW" && Number.isFinite(Number(agg.smartMarketPrice?.price))
        ? Number(agg.smartMarketPrice?.price)
        : null;
    const usd = smartRaw && smartRaw > 0 ? smartRaw : Number(agg.medianPrice);
    if (!Number.isFinite(usd) || usd <= 0) continue;

    rows.push({
      grade,
      providerKey,
      medianPence: toGbpPence(usd, "USD", rates),
      sampleSize: Math.round(count),
      source: "pokemon-price-tracker",
    });
  }
  return rows;
}

function estimateTrendPct(
  prices: Record<string, unknown> | undefined,
  agg: {
    marketPrice7Day?: number | null;
    marketPriceMedian7Day?: number | null;
  } | undefined,
): number | null {
  if (!prices) return null;
  const marketNow = readNumber(prices.market);
  const market7 = readNumber(agg?.marketPrice7Day);
  if (marketNow && market7) {
    return Math.round(((market7 - marketNow) / marketNow) * 1000) / 10;
  }

  const marketMedian7 = readNumber(agg?.marketPriceMedian7Day);
  if (marketNow && marketMedian7) {
    return Math.round(((marketMedian7 - marketNow) / marketNow) * 1000) / 10;
  }

  return null;
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function providerPayloadMatchesRequest(json: unknown, request: CardRef): boolean {
  const strictMatch = selectMatchingPptCard(json, request, { allowSetless: false });
  if (strictMatch) return true;

  const fallbackMatch = selectMatchingPptCard(json, request, { allowSetless: true });
  if (!fallbackMatch) return false;

  const hasProviderSet = listProviderCards(json).some((card) => Boolean(normalizeSearchText(readProviderSetName(card) ?? "").trim()));
  if (hasProviderSet) return false;
  return true;
}

export function selectMatchingPptCard(
  json: unknown,
  request: CardRef,
  options: { allowSetless: boolean } = { allowSetless: false },
): Record<string, unknown> | null {
  const profiles = buildRequestMatchProfiles(request, options);
  for (const candidate of listProviderCards(json)) {
    for (const profile of profiles) {
      if (providerPayloadMatchesRequestProfile(candidate, profile)) return candidate;
    }
  }
  return null;
}

function readProviderCard(json: unknown): PptProviderCard | null {
  const cards = listProviderCards(json);
  return cards[0] ?? null;
}

function providerCardRef(card: PptProviderCard | null): (CardRef & { imageUrl?: string; imageCdnUrl?: string; imageCdnUrl800?: string }) | undefined {
  if (!card) return undefined;
  const imageUrl = readProviderImageUrl(card);
  const imageCdnUrl = readProviderString(card, "imageCdnUrl");
  const imageCdnUrl800 = readProviderString(card, "imageCdnUrl800");
  return {
    name: readProviderString(card, "name") ?? "Unknown card",
    setName: readProviderSetName(card) ?? undefined,
    number: readProviderCollectorNumber(card),
    ...(imageUrl ? { imageUrl } : {}),
    ...(imageCdnUrl ? { imageCdnUrl } : {}),
    ...(imageCdnUrl800 ? { imageCdnUrl800 } : {}),
    game: "POKEMON",
    language: "EN",
  };
}

function readProviderImageUrl(card: PptProviderCard | null): string | null {
  if (!card) return null;
  return firstHttpUrl(
    readProviderString(card, "imageCdnUrl800"),
    readProviderString(card, "imageCdnUrl400"),
    readProviderString(card, "imageCdnUrl200"),
    readProviderString(card, "imageCdnUrl"),
    readProviderString(card, "imageUrl"),
    readProviderString(card, "image"),
  );
}

function firstHttpUrl(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && /^https?:\/\//i.test(trimmed)) return trimmed;
  }
  return null;
}

function listProviderCards(json: unknown): PptProviderCard[] {
  const root = json as { data?: unknown } | null;
  const data = root?.data;
  if (Array.isArray(data)) {
    return data.filter(isPptProviderCard);
  }
  if (data && isPptProviderCard(data)) return [data];
  if (isPptProviderCard(root)) return [root];
  return [];
}

function providerPayloadMatchesRequestProfile(providerCard: Record<string, unknown>, request: CardRef): boolean {
  if (requestsFirstEdition(request) && !providerPayloadMentionsFirstEdition(providerCard)) return false;
  const requestedPrint = { ...detectCardPrintIdentity(request), edition: request.edition ?? detectCardPrintIdentity(request).edition, finish: request.finish ?? detectCardPrintIdentity(request).finish };
  const providerPrint = detectCardPrintIdentity({
    name: ["name", "variant", "printing", "edition", "finish"].map((key) => readProviderString(providerCard, key)).filter(Boolean).join(" "),
    setName: readProviderSetName(providerCard),
  });
  if (requestedPrint.edition && requestedPrint.edition !== providerPrint.edition) return false;
  if (requestedPrint.finish && requestedPrint.finish !== providerPrint.finish) return false;

  const providerName = normalizeSearchText(readProviderString(providerCard, "name") ?? "");
  const requestedName = normalizeSearchText(request.name);
  if (providerName && requestedName && !providerName.includes(requestedName) && !requestedName.includes(providerName)) {
    const requestedTokens = tokenizeSearchText(request.name);
    if (!requestedTokens.every((token) => providerName.includes(token))) return false;
  }

  const providerNumber = readProviderCollectorNumber(providerCard);
  const requestedNumber = normalizeProviderCollectorNumber(request.number, request.setName);
  if (providerNumber && requestedNumber && !collectorNumbersEquivalent(providerNumber, requestedNumber)) return false;

  // Collector numbers repeat across many sets (Base 4/102 vs Base Set 2
  // 4/130). Prefer canonical set ids when both identities can be resolved;
  // fuzzy token matching alone is too permissive for numbered sequel sets.
  const providerSetName = readProviderSetName(providerCard) ?? undefined;
  const requestedSetId = resolveSetIdForCard(request.setName, request.number);
  const providerSetId = resolveSetIdForCard(providerSetName, providerNumber);
  if (
    requestedSetId &&
    providerSetId &&
    requestedSetId !== providerSetId &&
    !providerCollectorPrefixPinsSet(providerNumber, requestedSetId)
  ) return false;

  const providerSet = normalizeSearchText(stripProviderSetCodePrefix(providerSetName));
  if (request.setName && providerSet) {
    if (!providerSetMatchesRequest(request.setName, providerSet)) {
      return false;
    }
  }

  return true;
}

function providerCollectorPrefixPinsSet(number: string | undefined, setId: string): boolean {
  const prefix = number?.trim().match(/^([A-Za-z]{2,5})/)?.[1]?.toUpperCase();
  return ({ SVP: "svp", MEP: "mep", SWSH: "swshp", SMP: "smp", XYP: "xyp" } as Record<string, string>)[prefix ?? ""] === setId;
}

const ignoredSetTokens = new Set(["set", "promo", "pokemon", "card"]);

function providerSetMatchesRequest(requestedSetName: string, providerSet: string): boolean {
  const normalizedProviderSet = stripProviderSetCodePrefix(providerSet);
  const requestedTokens = tokenizeSearchText(requestedSetName)
    .map((token) => token.toLowerCase())
    .filter(
      (token) =>
        token.length >= 3 &&
        !ignoredSetTokens.has(token) &&
        !/^(?:sv|swsh|xy|sws|sm|bw|dp|hgss|svp|mep|xyp)$/.test(token),
    );
  if (requestedTokens.length === 0) return true;

  const providerTokens = tokenizeSearchText(normalizedProviderSet).map((token) => token.toLowerCase());
  if (providerTokens.length === 0) return true;

  const providerSubsetMatchesRequested = providerTokens.every((providerToken) =>
    requestedTokens.some((requestedToken) => tokenMatches(requestedToken, providerToken)),
  );
  if (requestedTokens.length > 2 && providerSubsetMatchesRequested) {
    return true;
  }

  const matchingTokens = requestedTokens.filter((token) =>
    providerTokens.some((candidate) => tokenMatches(token, candidate)),
  );
  if (requestedTokens.length <= 2) {
    return matchingTokens.length === requestedTokens.length;
  }

  return matchingTokens.length >= Math.ceil(requestedTokens.length * 0.6);
}

function buildRequestMatchProfiles(request: CardRef, options: { allowSetless: boolean } = { allowSetless: false }): CardRef[] {
  const number = request.number?.trim();
  const normalizedSetName = request.setName?.trim();
  const requestedNumber = normalizeCollectorNumberForCompare(normalizeProviderCollectorNumber(number, request.setName));
  const leftNumber = requestedNumber?.split("/")[0];

  const profiles: CardRef[] = [{ ...request }];
  if (options.allowSetless && normalizedSetName) {
    profiles.push({ ...request, setName: undefined });
  }

  if (leftNumber && leftNumber !== requestedNumber) {
    profiles.push({ ...request, number: leftNumber, setName: request.setName });
    if (options.allowSetless && normalizedSetName) {
      profiles.push({ ...request, number: leftNumber, setName: undefined });
    }
  }

  const deduped = new Map<string, CardRef>();
  for (const profile of profiles) {
    const key = JSON.stringify({
      name: profile.name.trim(),
      setName: profile.setName?.trim() ?? "",
      number: normalizeCollectorNumberForCompare(normalizeProviderCollectorNumber(profile.number, profile.setName)) ?? profile.number,
    });
    deduped.set(key, profile);
  }

  return [...deduped.values()];
}

function isPptProviderCard(value: unknown): value is PptProviderCard {
  return value != null && typeof value === "object";
}

function providerPayloadMentionsFirstEdition(card: Record<string, unknown>): boolean {
  return [
    readProviderString(card, "name"),
    readProviderString(card, "variant"),
    readProviderString(card, "printing"),
    readProviderString(card, "edition"),
    readProviderSetName(card),
  ].some((value) => textMentionsFirstEdition(value));
}

function readProviderString(card: Record<string, unknown>, key: string): string | null {
  const value = card[key];
  return typeof value === "string" ? value : null;
}

function readProviderSetName(card: Record<string, unknown>): string | null {
  const direct = readProviderString(card, "setName");
  if (direct) return direct;

  const set = card.set;
  if (typeof set === "string") return set;
  if (set && typeof set === "object") {
    const name = (set as Record<string, unknown>).name;
    if (typeof name === "string") return name;
  }

  return null;
}

function readProviderCollectorNumber(card: Record<string, unknown>): string | undefined {
  const direct =
    readProviderString(card, "number") ??
    readProviderString(card, "cardNumber") ??
    readProviderString(card, "collectorNumber") ??
    undefined;
  if (direct) return direct;
  const name = readProviderString(card, "name") ?? "";
  return name.match(/\b([A-Z]{0,5}\d{1,4}\s*\/\s*[A-Z]{0,5}\d{1,4})\b/i)?.[1];
}
