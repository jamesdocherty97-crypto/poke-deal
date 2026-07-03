import { getRates, toGbpPence, type FxRates } from "../comps/currency.js";
import type { CardRef, Currency, Grade } from "../domain/types.js";
import { cardSearchQuery, ebaySoldSearchQuery } from "../dealer/compLinks.js";
import { EBAY_UK_CATEGORY_POKEMON, getEbayConfig } from "./config.js";
import { ebayJson } from "./client.js";
import { getApplicationAccessToken } from "./tokens.js";

export interface EbayAskListing {
  itemId: string;
  title: string;
  url: string;
  imageUrl?: string;
  itemPricePence: number;
  shippingPence: number;
  totalPence: number;
  buyingOptions: string[];
  condition?: string;
  seller?: string;
}

export interface EbayAskEvidence {
  source: "ebay-browse";
  marketplaceId: string;
  query: string;
  asOf: string;
  count: number;
  listings: EbayAskListing[];
  lowestPence: number | null;
  undercutPence: number | null;
  cached?: boolean;
  skipped?: boolean;
  reason?: string;
}

interface BrowseSearchResponse {
  itemSummaries?: BrowseItemSummary[];
}

interface BrowseItemSummary {
  itemId?: string;
  title?: string;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  image?: { imageUrl?: string };
  price?: MoneyValue;
  shippingOptions?: Array<{ shippingCost?: MoneyValue }>;
  buyingOptions?: string[];
  condition?: string;
  seller?: { username?: string };
}

interface MoneyValue {
  value?: string;
  currency?: string;
}

interface CacheEntry {
  expiresAt: number;
  evidence: EbayAskEvidence;
}

interface BrowseBudgetState {
  dayKey: string;
  count: number;
}

export interface EbayAskLookupOptions {
  grade?: Grade;
  now?: Date;
  limit?: number;
  fetchImpl?: typeof fetch;
  rates?: FxRates;
}

const ASK_CACHE_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;
const DEFAULT_DAILY_BUDGET = 500;
const ASK_DISPLAY_LIMIT = 5;

const askCache = new Map<string, CacheEntry>();
let browseBudget: BrowseBudgetState = { dayKey: "", count: 0 };

export async function fetchEbayAskEvidence(
  card: CardRef,
  options: EbayAskLookupOptions = {},
): Promise<EbayAskEvidence> {
  const now = options.now ?? new Date();
  const grade = options.grade ?? "RAW";
  const query = buildEbayAskQuery(card, grade);
  const marketplaceId = "EBAY_GB";
  const baseEvidence = (fields: Partial<EbayAskEvidence> = {}): EbayAskEvidence => ({
    source: "ebay-browse",
    marketplaceId,
    query,
    asOf: now.toISOString(),
    count: 0,
    listings: [],
    lowestPence: null,
    undercutPence: null,
    ...fields,
  });

  if (!query) return baseEvidence({ skipped: true, reason: "No eBay Browse query could be built." });

  const cacheKey = askCacheKey(card, grade, query);
  const cached = askCache.get(cacheKey);
  if (cached && cached.expiresAt > now.getTime()) {
    return { ...cached.evidence, cached: true };
  }

  const config = getEbayConfig();
  if (!config) return baseEvidence({ skipped: true, reason: "eBay credentials are not configured." });

  const budget = claimBrowseBudget(now);
  if (!budget.allowed) {
    const evidence = baseEvidence({ skipped: true, reason: budget.reason });
    console.warn(`[ebay-browse] skipped UK ask lookup: ${budget.reason}`);
    return evidence;
  }

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const token = await getApplicationAccessToken(config, fetchImpl);
    const path = buildEbayAskSearchPath(query, { limit: options.limit ?? DEFAULT_LIMIT });
    const response = await ebayJson<BrowseSearchResponse>(
      config,
      path,
      token,
      { method: "GET", marketplaceId },
      fetchImpl,
    );
    const rates = options.rates ?? await getRates();
    const listings = mapBrowseAskListings(response, card, grade, rates)
      .sort((a, b) => a.totalPence - b.totalPence)
      .slice(0, ASK_DISPLAY_LIMIT);
    const lowestPence = listings[0]?.totalPence ?? null;
    const evidence = baseEvidence({
      count: listings.length,
      listings,
      lowestPence,
      undercutPence: lowestPence == null ? null : undercutAskPence(lowestPence),
    });
    askCache.set(cacheKey, { evidence, expiresAt: now.getTime() + ASK_CACHE_MS });
    return evidence;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "eBay Browse ask lookup failed.";
    console.warn(`[ebay-browse] UK ask lookup failed: ${reason}`);
    return baseEvidence({ skipped: true, reason });
  }
}

export function buildEbayAskQuery(card: CardRef, grade: Grade): string {
  return ebaySoldSearchQuery(cardSearchQuery(card), grade);
}

export function buildEbayAskSearchPath(query: string, options: { limit?: number } = {}): string {
  const params = new URLSearchParams({
    q: query,
    category_ids: EBAY_UK_CATEGORY_POKEMON,
    limit: String(Math.min(Math.max(Math.round(options.limit ?? DEFAULT_LIMIT), 1), 50)),
    sort: "price",
    filter: "buyingOptions:{FIXED_PRICE|AUCTION},itemLocationCountry:GB,priceCurrency:GBP",
  });
  return `/buy/browse/v1/item_summary/search?${params.toString()}`;
}

export function mapBrowseAskListings(
  response: BrowseSearchResponse,
  card: CardRef,
  grade: Grade,
  rates = { asOf: "2026-07-03", perGbp: { GBP: 1, EUR: 1, USD: 1, JPY: 1 } } as FxRates,
): EbayAskListing[] {
  return (response.itemSummaries ?? [])
    .map((item) => mapBrowseAskListing(item, rates))
    .filter((item): item is EbayAskListing => item != null)
    .filter((item) => titleMatchesAskContext(item.title, card, grade));
}

export function titleMatchesAskContext(title: string, card: CardRef, grade: Grade): boolean {
  const normalizedTitle = normalizeSearchTitle(title);
  if (!normalizedTitle) return false;

  const nameTokens = meaningfulTokens(card.name);
  if (nameTokens.length > 0 && !nameTokens.every((token) => normalizedTitle.includes(token))) return false;

  const numberTokens = collectorNumberTokens(card.number);
  if (numberTokens.length > 0 && !numberTokens.every((token) => normalizedTitle.includes(token))) return false;

  const isDamaged = /\b(?:damaged|damage|dmg|poor|crease|creased|heavily played|hp)\b/.test(normalizedTitle);
  if (isDamaged) return false;
  if (/\b(?:proxy|custom|metal|jumbo|oversized|digital|binder|insert|display|sticker|poster|canvas|artwork|fan\s*art|extended\s*art|chance\s*pack|mystery|repack)\b/.test(normalizedTitle)) return false;

  if (grade === "RAW") {
    return !/\b(?:psa|bgs|cgc|ace|sgc)\s*(?:10|9(?:\.5)?|[1-8](?:\.5)?)\b/.test(normalizedTitle) &&
      !/\bgraded\b/.test(normalizedTitle);
  }

  return titleMentionsGrade(normalizedTitle, grade);
}

export function undercutAskPence(lowestPence: number): number {
  const step = lowestPence <= 2_000 ? 50 : 100;
  return Math.max(1, lowestPence - step);
}

export function attachAskEvidence<T extends { headline: unknown; all: unknown[] }>(
  comp: T,
  askEvidence: EbayAskEvidence,
): T & { askEvidence: EbayAskEvidence } {
  return { ...comp, askEvidence };
}

export function resetEbayAskCacheForTests(): void {
  askCache.clear();
  browseBudget = { dayKey: "", count: 0 };
}

function mapBrowseAskListing(item: BrowseItemSummary, rates: FxRates): EbayAskListing | null {
  const title = item.title?.trim();
  const url = (item.itemAffiliateWebUrl ?? item.itemWebUrl)?.trim();
  const itemPricePence = moneyToGbpPence(item.price, rates);
  if (!title || !url || itemPricePence <= 0) return null;

  const shippingPence = Math.max(0, moneyToGbpPence(item.shippingOptions?.[0]?.shippingCost, rates));
  return {
    itemId: item.itemId ?? url,
    title,
    url,
    imageUrl: item.image?.imageUrl,
    itemPricePence,
    shippingPence,
    totalPence: itemPricePence + shippingPence,
    buyingOptions: item.buyingOptions ?? [],
    condition: item.condition,
    seller: item.seller?.username,
  };
}

function moneyToGbpPence(value: MoneyValue | undefined, rates: FxRates): number {
  const amount = Number(value?.value);
  const currency = readCurrency(value?.currency);
  if (!Number.isFinite(amount) || amount <= 0 || !currency) return 0;
  return toGbpPence(amount, currency, rates);
}

function readCurrency(value: string | undefined): Currency | null {
  if (value === "GBP" || value === "EUR" || value === "USD" || value === "JPY") return value;
  return null;
}

function claimBrowseBudget(now: Date): { allowed: true } | { allowed: false; reason: string } {
  const limit = readBrowseDailyBudget();
  const dayKey = now.toISOString().slice(0, 10);
  if (browseBudget.dayKey !== dayKey) browseBudget = { dayKey, count: 0 };
  if (browseBudget.count >= limit) return { allowed: false, reason: `Daily eBay Browse ask budget exhausted (${limit}).` };
  browseBudget.count += 1;
  return { allowed: true };
}

function readBrowseDailyBudget(): number {
  const parsed = Number(process.env.EBAY_BROWSE_DAILY_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DAILY_BUDGET;
  return Math.min(Math.round(parsed), DEFAULT_DAILY_BUDGET);
}

function askCacheKey(card: CardRef, grade: Grade, query: string): string {
  return [
    card.tcgApiId ?? "",
    card.tcgDexId ?? "",
    card.name.trim().toLowerCase(),
    card.setName?.trim().toLowerCase() ?? "",
    card.number?.trim().toLowerCase() ?? "",
    grade,
    query.trim().toLowerCase(),
  ].join("|");
}

function collectorNumberTokens(number: string | undefined): string[] {
  if (!number?.trim()) return [];
  const normalized = normalizeSearchTitle(number);
  const tokens = normalized.split(" ").filter(Boolean);
  const numeric = tokens.flatMap((token) => token.match(/\d+/g) ?? []);
  const prefix = tokens.find((token) => /^[a-z]{2,4}$/.test(token));
  if (prefix && numeric[0]) return [prefix, numeric[0].replace(/^0+/, "") || "0"];
  if (/^[a-z]{1,4}\d+$/i.test(number.trim())) {
    const match = number.trim().match(/^([a-z]{1,4})0*(\d+)$/i);
    if (match?.[1] && match[2]) return [match[1].toLowerCase(), match[2]];
  }
  return numeric.length > 0 ? [numeric[0]!.replace(/^0+/, "") || "0"] : tokens;
}

function meaningfulTokens(value: string): string[] {
  return normalizeSearchTitle(value)
    .split(" ")
    .filter((token) => token.length > 1)
    .filter((token) => !["pokemon", "card", "the"].includes(token));
}

function titleMentionsGrade(normalizedTitle: string, grade: Grade): boolean {
  const label = grade.replace(/_(\d)_5$/g, " $1.5").replace(/_(\d+)$/g, " $1").replace(/_/g, " ");
  const normalizedGrade = normalizeSearchTitle(label);
  return normalizedTitle.includes(normalizedGrade) || normalizedTitle.replace(/\s+/g, "").includes(normalizedGrade.replace(/\s+/g, ""));
}

function normalizeSearchTitle(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\b0+(\d+)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
