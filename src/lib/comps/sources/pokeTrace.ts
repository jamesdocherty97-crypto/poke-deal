import type { CardRef, CompQuery, CompResult, Grade } from "../../domain/types.js";
import { getSetById, resolveSetId } from "../../catalog/setCatalog.js";
import { tokenizeSearchText, tokenMatches } from "../../catalog/fuzzy.js";
import {
  collectorNumbersEquivalent,
  normalizeCollectorNumberForCompare,
  stripLeadingZerosFromNumericSegment,
  stripProviderSetCodePrefix,
} from "../../cards/identity.js";
import type { CompSource } from "../CompSource.js";
import { DEFAULT_WINDOW_DAYS } from "../cleaning.js";
import { fxRateInfo, getRates, STATIC_RATES, toGbpPence, type FxRates } from "../currency.js";
import { requestsFirstEdition, textMentionsFirstEdition } from "../variants.js";

const BASE_URL = "https://api.poketrace.com/v1";
const DEFAULT_FETCH_TIMEOUT_MS = 2200;
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const MARKET_DENY_TTL_MS = 6 * 60 * 60 * 1000;
// Free tier allows only 1 request / 2s. Multi-market fallback can fire two
// requests, so without spacing the second call is rate-limited (429) and
// PokeTrace silently returns nothing. We pause before fallback markets to clear
// the burst window. Free-tier accounts should usually run US only.
const DEFAULT_INTER_MARKET_DELAY_MS = 2100;
const RAW_EBAY_SOLD_SAMPLE_FLOOR = 30;
const RAW_EBAY_INFLATION_LIMIT = 1.2;
let sharedPokeTraceRequestAt = 0;
let sharedPokeTraceQueue = Promise.resolve();
let sharedPokeTraceCooldownUntil = 0;
let sharedPokeTraceCooldownReason: "rate-limit" | "forbidden" | null = null;
let sharedPokeTraceHadForbiddenCooldown = false;
let sharedPokeTracePersistentKeyProblem = false;
let sharedPokeTraceMarketDeniedUntil: Partial<Record<PokeTraceMarket, number>> = {};
let sharedPokeTraceStats = emptyPokeTraceStats();

type PokeTraceMarket = "US" | "EU";
type PokeTraceFetchResult = Response | "rate-limit-cooldown" | "market-forbidden";

export type PokeTraceHealth = {
  inCooldown: boolean;
  cooldownUntil: string | null;
  cooldownReason: "rate-limit" | "forbidden" | null;
  persistentKeyProblem: boolean;
  deniedMarkets: Array<{ market: PokeTraceMarket; until: string }>;
  stats: PokeTraceStats;
};

export type PokeTraceStats = {
  calls: number;
  rateLimited: number;
  forbidden: number;
  cooldowns: number;
};

type PokeTracePriceTier = {
  avg?: unknown;
  low?: unknown;
  high?: unknown;
  saleCount?: unknown;
  approxSaleCount?: unknown;
  avg1d?: unknown;
  avg7d?: unknown;
  avg30d?: unknown;
};

type PokeTraceCard = {
  id?: unknown;
  name?: unknown;
  cardNumber?: unknown;
  set?: { name?: unknown; slug?: unknown };
  image?: unknown;
  market?: unknown;
  currency?: unknown;
  prices?: Record<string, Record<string, PokeTracePriceTier | undefined> | undefined>;
  lastUpdated?: unknown;
  totalSaleCount?: unknown;
};

type PokeTracePayload = {
  data?: PokeTraceCard | PokeTraceCard[];
};

type PokeTraceTierChoice = {
  tier: PokeTracePriceTier;
  tierKey: string;
  priceSource: string;
  kind: "market-baseline" | "sold-aggregate";
};

type PokeTraceSignal = {
  priceSource: string;
  tier: string;
  kind: "market-baseline" | "sold-aggregate";
  market?: string;
  currency: Exclude<ReturnType<typeof readCurrency>, null>;
  medianPence: number;
  lowPence: number;
  highPence: number;
  sampleSize: number;
  trendPct: number | null;
  approxSaleCount: boolean;
};

type MapContext = {
  source: string;
  card: CardRef;
  grade: Grade;
  windowDays: number;
};

export class PokeTraceSource implements CompSource {
  readonly name = "poketrace";
  readonly live: boolean;

  constructor(
    private readonly apiKey: string | undefined = process.env.POKETRACE_API_KEY,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    private readonly interMarketDelayMs = DEFAULT_INTER_MARKET_DELAY_MS,
    private readonly useSharedThrottle = fetchImpl === fetch,
    private readonly cooldownMs = DEFAULT_COOLDOWN_MS,
    private readonly sleepImpl: (ms: number) => Promise<void> = sleep,
    private readonly markets: PokeTraceMarket[] = readPokeTraceMarkets(),
  ) {
    this.live = Boolean(apiKey && apiKey.trim().length > 0);
  }

  async lookup(card: CardRef, query: CompQuery = {}): Promise<CompResult> {
    const grade = query.grade ?? "RAW";
    const windowDays = query.windowDays ?? DEFAULT_WINDOW_DAYS;
    const ctx = { source: this.name, card, grade, windowDays };
    if (!this.live) return emptyComp(ctx, "PokeTrace key missing");
    const cooldown = readPokeTraceCooldown();
    if (cooldown) return emptyComp(ctx, `PokeTrace source unavailable: ${cooldown}`);

    let lastEmpty: CompResult | null = null;
    let deniedMarkets = 0;
    const markets = this.markets;
    for (let i = 0; i < markets.length; i += 1) {
      const market = markets[i]!;
      if (readPokeTraceMarketDeny(market)) {
        deniedMarkets += 1;
        lastEmpty = emptyComp(ctx, `PokeTrace ${market} market not permitted`);
        continue;
      }
      // Respect the free-tier 1-req/2s burst limit before the fallback market call.
      if (i > 0 && this.interMarketDelayMs > 0) await this.sleepImpl(this.interMarketDelayMs);
      const midRunCooldown = readPokeTraceCooldown();
      if (midRunCooldown) return emptyComp(ctx, `PokeTrace source unavailable: ${midRunCooldown}`);
      const payload = await this.fetchCards(card, market);
      if (payload === "market-forbidden") {
        deniedMarkets += 1;
        lastEmpty = emptyComp(ctx, `PokeTrace ${market} market not permitted`);
        continue;
      }
      const rates = await getRates();
      const comp = payload == null
        ? emptyComp(ctx, `PokeTrace ${market} lookup failed or returned no response`)
        : mapPokeTraceCardsToComp(payload, ctx, rates);
      if (comp.sampleSize > 0 && comp.medianPence > 0) return comp;
      lastEmpty = comp;
    }

    if (markets.length > 0 && deniedMarkets >= markets.length) {
      enterPokeTraceCooldown("forbidden", this.cooldownMs);
      return emptyComp(ctx, "PokeTrace source unavailable: key problem");
    }
    return lastEmpty ?? emptyComp(ctx, "PokeTrace lookup failed or returned no response");
  }

  private async fetchCards(card: CardRef, market: PokeTraceMarket): Promise<unknown | "market-forbidden" | null> {
    for (const search of buildPokeTraceSearchVariants(card)) {
      const params = new URLSearchParams({
        search,
        market,
        product_type: "single",
        limit: "3",
      });

      try {
        if (this.useSharedThrottle) await waitForSharedPokeTraceSlot(this.interMarketDelayMs);
        const cooldown = readPokeTraceCooldown();
        if (cooldown) return null;
        const res = await this.fetchWithRetry(`${BASE_URL}/cards?${params.toString()}`, market);
        if (res === "market-forbidden") return "market-forbidden";
        if (res === "rate-limit-cooldown") return null;
        if (!res.ok) {
          console.warn(`[${this.name}] HTTP ${res.status} - no comp returned`);
          continue;
        }
        const json = markPokeTracePayloadMarket((await res.json()) as unknown, market);
        if (findMatchingPokeTraceCard(json, card)) return json;
      } catch (err) {
        console.warn(`[${this.name}] fetch failed: ${(err as Error).message}`);
      }
    }

    return null;
  }

  private async fetchWithRetry(url: string, market: PokeTraceMarket): Promise<PokeTraceFetchResult> {
    let rateLimitCount = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      sharedPokeTraceStats.calls += 1;
      const res = await this.fetchImpl(url, {
        headers: { "X-API-Key": this.apiKey ?? "", Accept: "application/json" },
        signal: timeoutSignal(this.fetchTimeoutMs),
      });
      if (res.status === 403) {
        sharedPokeTraceStats.forbidden += 1;
        enterPokeTraceMarketDeny(market);
        console.warn(`[${this.name}] HTTP 403 - ${market} market not permitted`);
        return "market-forbidden";
      }
      if (res.status !== 429) return res;

      rateLimitCount += 1;
      sharedPokeTraceStats.rateLimited += 1;
      if (rateLimitCount >= 2) {
        enterPokeTraceCooldown("rate-limit", this.cooldownMs);
        console.warn(`[${this.name}] HTTP 429 - cooling source down`);
        return "rate-limit-cooldown";
      }
      await this.sleepImpl(retryDelayMs(res, rateLimitCount));
    }
    return "rate-limit-cooldown";
  }
}

export function resetPokeTraceSharedThrottleForTests(): void {
  sharedPokeTraceRequestAt = 0;
  sharedPokeTraceQueue = Promise.resolve();
}

export function resetPokeTraceSourceHealthForTests(): void {
  sharedPokeTraceCooldownUntil = 0;
  sharedPokeTraceCooldownReason = null;
  sharedPokeTraceHadForbiddenCooldown = false;
  sharedPokeTracePersistentKeyProblem = false;
  sharedPokeTraceMarketDeniedUntil = {};
  sharedPokeTraceStats = emptyPokeTraceStats();
}

export function resetPokeTraceRunStats(): void {
  sharedPokeTraceStats = emptyPokeTraceStats();
}

export function getPokeTraceHealth(now = Date.now()): PokeTraceHealth {
  const inCooldown = sharedPokeTraceCooldownUntil > now;
  return {
    inCooldown,
    cooldownUntil: inCooldown ? new Date(sharedPokeTraceCooldownUntil).toISOString() : null,
    cooldownReason: inCooldown ? sharedPokeTraceCooldownReason : null,
    persistentKeyProblem: sharedPokeTracePersistentKeyProblem,
    deniedMarkets: Object.entries(sharedPokeTraceMarketDeniedUntil)
      .filter((entry): entry is [PokeTraceMarket, number] => isPokeTraceMarket(entry[0]) && entry[1] > now)
      .map(([market, until]) => ({ market, until: new Date(until).toISOString() })),
    stats: { ...sharedPokeTraceStats },
  };
}

export function readPokeTraceMarkets(raw = process.env.POKETRACE_MARKETS): PokeTraceMarket[] {
  const markets = (raw?.trim() ? raw : "US,EU")
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(isPokeTraceMarket);
  return [...new Set(markets)].length > 0 ? [...new Set(markets)] : ["US", "EU"];
}

export function gradeToPokeTraceTier(grade: Grade): string {
  return grade === "RAW" ? "NEAR_MINT" : grade;
}

export function mapPokeTraceCardsToComp(
  json: unknown,
  ctx: MapContext,
  rates: FxRates = STATIC_RATES,
): CompResult {
  const card = findMatchingPokeTraceCard(json, ctx.card);
  if (!card) return emptyComp(ctx, "no PokeTrace card match");

  const choice = chooseTier(card, ctx.grade);
  if (!choice) return emptyComp(ctx, `no PokeTrace ${ctx.grade.replace(/_/g, " ")} price tier`);

  const currency = readCurrency(card.currency);
  if (!currency) return emptyComp(ctx, "PokeTrace returned an unsupported currency");

  const avgPence = priceToGbpPence(choice.tier.avg, currency, rates);
  if (avgPence <= 0) return emptyComp(ctx, "PokeTrace returned no usable price");

  const lowPence = priceToGbpPence(choice.tier.low, currency, rates) || avgPence;
  const highPence = priceToGbpPence(choice.tier.high, currency, rates) || avgPence;
  const sampleSize = readPositiveInt(choice.tier.saleCount) ?? readPositiveInt(card.totalSaleCount) ?? 1;
  const canonicalCard = canonicalCardRef(ctx.card, card);
  const signals = collectPokeTraceSignals(card, ctx.grade, currency, rates);

  return {
    source: ctx.source,
    card: canonicalCard,
    grade: ctx.grade,
    currency: "GBP",
    medianPence: avgPence,
    meanPence: avgPence,
    lowPence,
    highPence,
    sampleSize,
    windowDays: ctx.windowDays,
    trendPct: trendPct(choice.tier),
    outliersRemoved: 0,
    asOf: parseDate(card.lastUpdated),
    raw: {
      kind: choice.kind,
      tier: choice.tierKey,
      priceSource: choice.priceSource,
      market: readString(card.market),
      currency,
      fx: fxRateInfo(rates),
      displayImageUrl: readProviderImageUrl(card),
      providerCard: providerCardRef(card),
      approxSaleCount: Boolean(choice.tier.approxSaleCount),
      signals,
      ...choice.tier,
    },
  };
}

export function buildPokeTraceSearchVariants(card: CardRef): string[] {
  const name = card.name.trim();
  const rawNumber = card.number?.trim().replace(/\s+/g, "");
  const number = rawNumber ? (stripLeadingZeros(rawNumber) ?? rawNumber) : undefined;
  if (!name) return [];

  const variants = new Set<string>();
  const strippedPromo = stripPromoCollectorPrefix(number);
  const hasSlash = number?.includes("/") === true;

  if (number) {
    variants.add([name, number].join(" "));
    const comparableNumber = normalizeCollectorNumberForCompare(number);
    if (comparableNumber && comparableNumber !== number) variants.add([name, comparableNumber].join(" "));
    for (const padded of numericSlashPaddedForms(number)) {
      variants.add([name, padded].join(" "));
    }
    if (!hasSlash) {
      if (strippedPromo) {
        variants.add([name, strippedPromo].join(" "));
        const strippedDigits = stripLeadingZeros(strippedPromo);
        if (strippedDigits) variants.add([name, strippedDigits].join(" "));
      }
      const unpadded = stripLeadingZeros(number);
      if (unpadded && unpadded !== number) variants.add([name, unpadded].join(" "));
    }
  }
  if (!hasSlash) variants.add(name);
  return [...variants];
}

function numericSlashPaddedForms(number: string): string[] {
  const match = number.match(/^(\d{1,4})\/(\d{1,4})$/);
  if (!match?.[1] || !match[2]) return [];
  const left = match[1].padStart(3, "0");
  const right = match[2].padStart(3, "0");
  return [...new Set([`${left}/${match[2]}`, `${left}/${right}`].filter((candidate) => candidate !== number))];
}

function chooseTier(card: PokeTraceCard, grade: Grade): PokeTraceTierChoice | null {
  const tierKey = gradeToPokeTraceTier(grade);
  if (grade === "RAW") {
    const cardmarket = card.prices?.cardmarket?.[tierKey] ?? card.prices?.cardmarket_unsold?.[tierKey];
    if (cardmarket) return { tier: cardmarket, tierKey, priceSource: "cardmarket", kind: "market-baseline" };
    const tcgplayer = card.prices?.tcgplayer?.[tierKey];
    const ebay = card.prices?.ebay?.[tierKey];
    if (ebay && (!tcgplayer || shouldPreferRawEbaySoldAggregate(ebay, tcgplayer))) {
      return { tier: ebay, tierKey, priceSource: "ebay", kind: "sold-aggregate" };
    }
    if (tcgplayer) return { tier: tcgplayer, tierKey, priceSource: "tcgplayer", kind: "market-baseline" };
    if (ebay) return { tier: ebay, tierKey, priceSource: "ebay", kind: "sold-aggregate" };
    return null;
  }

  const ebay = card.prices?.ebay?.[tierKey];
  if (ebay) return { tier: ebay, tierKey, priceSource: "ebay", kind: "sold-aggregate" };
  const cardmarket = card.prices?.cardmarket_unsold?.[tierKey];
  if (cardmarket) return { tier: cardmarket, tierKey, priceSource: "cardmarket_unsold", kind: "market-baseline" };
  return null;
}

function shouldPreferRawEbaySoldAggregate(ebay: PokeTracePriceTier, baseline: PokeTracePriceTier): boolean {
  const saleCount = readPositiveInt(ebay.saleCount) ?? 0;
  if (saleCount < RAW_EBAY_SOLD_SAMPLE_FLOOR) return false;

  const ebayAvg = readPositiveNumber(ebay.avg);
  const baselineAvg = readPositiveNumber(baseline.avg);
  if (!ebayAvg || !baselineAvg) return true;

  // Raw eBay buckets can be polluted by graded or mislabelled sales. A strong
  // sold sample is useful, but only when it is not inflated above the cleaner
  // market baseline.
  return ebayAvg <= baselineAvg * RAW_EBAY_INFLATION_LIMIT;
}

function collectPokeTraceSignals(
  card: PokeTraceCard,
  grade: Grade,
  currency: PokeTraceSignal["currency"],
  rates: FxRates,
): PokeTraceSignal[] {
  const tierKey = gradeToPokeTraceTier(grade);
  const market = readString(card.market) ?? undefined;
  const signals: PokeTraceSignal[] = [];
  for (const [priceSource, tiers] of Object.entries(card.prices ?? {})) {
    const tier = tiers?.[tierKey];
    if (!tier) continue;
    const medianPence = priceToGbpPence(tier.avg, currency, rates);
    if (medianPence <= 0) continue;
    signals.push({
      priceSource,
      tier: tierKey,
      kind: priceSource === "ebay" ? "sold-aggregate" : "market-baseline",
      market,
      currency,
      medianPence,
      lowPence: priceToGbpPence(tier.low, currency, rates) || medianPence,
      highPence: priceToGbpPence(tier.high, currency, rates) || medianPence,
      sampleSize: readPositiveInt(tier.saleCount) ?? readPositiveInt(card.totalSaleCount) ?? 1,
      trendPct: trendPct(tier),
      approxSaleCount: Boolean(tier.approxSaleCount),
    });
  }
  return signals.sort((a, b) => pokeTraceSignalPriority(b) - pokeTraceSignalPriority(a));
}

function pokeTraceSignalPriority(signal: PokeTraceSignal): number {
  const sourcePriority =
    signal.priceSource === "cardmarket"
      ? 90
      : signal.priceSource === "tcgplayer"
        ? 60
        : signal.priceSource === "ebay"
          ? 50
          : signal.priceSource === "cardmarket_unsold"
            ? 40
            : 20;
  return sourcePriority + Math.min(signal.sampleSize, 50);
}

function emptyComp(ctx: MapContext, reason = "no PokeTrace data"): CompResult {
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

function canonicalCardRef(input: CardRef, card: PokeTraceCard): CardRef {
  const providerNumber = readString(card.cardNumber) ?? undefined;
  if (shouldKeepRequestedPromoIdentity(input, providerNumber)) {
    return {
      ...input,
      game: "POKEMON",
      language: input.language ?? "EN",
    };
  }

  return {
    ...input,
    name: readString(card.name) ?? input.name,
    setName: readString(card.set?.name) ?? input.setName,
    number: readString(card.cardNumber) ?? input.number,
    game: "POKEMON",
    language: input.language ?? "EN",
  };
}

function providerCardRef(card: PokeTraceCard): CardRef & { imageUrl?: string } {
  const imageUrl = readProviderImageUrl(card);
  return {
    name: readString(card.name) ?? "Unknown card",
    setName: readString(card.set?.name) ?? undefined,
    number: readString(card.cardNumber) ?? undefined,
    ...(imageUrl ? { imageUrl } : {}),
    game: "POKEMON",
    language: "EN",
  };
}

function readProviderImageUrl(card: PokeTraceCard): string | null {
  const image = readString(card.image);
  return image && /^https?:\/\//i.test(image) ? image : null;
}

function shouldKeepRequestedPromoIdentity(input: CardRef, providerNumber: string | undefined): boolean {
  const requestedNumber = input.number?.trim();
  if (!requestedNumber || !providerNumber) return false;
  return Boolean(stripPromoCollectorPrefix(requestedNumber)) && collectorNumberMatches(providerNumber, requestedNumber);
}

function findMatchingPokeTraceCard(json: unknown, request: CardRef): PokeTraceCard | null {
  const matchProfiles = buildPokeTraceMatchProfiles(request);
  return (
    readPokeTraceCards(json).find((card) => matchProfiles.some((matchRequest) => pokeTraceCardMatchesRequest(card, matchRequest))) ??
    null
  );
}

function readPokeTraceCards(json: unknown): PokeTraceCard[] {
  const payload = json as PokeTracePayload | null;
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
}

function buildPokeTraceMatchProfiles(request: CardRef): CardRef[] {
  const profiles: CardRef[] = [{ ...request }];
  const leftNumber = request.number?.trim().split("/")[0]?.trim();
  if (leftNumber && request.number && leftNumber !== request.number.trim()) {
    profiles.push({ ...request, number: leftNumber });
  }

  const deduped = new Map<string, CardRef>();
  for (const profile of profiles) {
    const key = JSON.stringify({
      name: profile.name.trim(),
      setName: profile.setName?.trim() ?? "",
      number: profile.number?.trim() ?? "",
    });
    deduped.set(key, profile);
  }

  return [...deduped.values()];
}

function pokeTraceCardMatchesRequest(card: PokeTraceCard, request: CardRef): boolean {
  const providerName = readString(card.name) ?? "";
  if (!tokensMatch(request.name, providerName)) return false;

  if (requestsFirstEdition(request) && !pokeTraceProviderMentionsFirstEdition(card)) return false;

  const requestedNumber = request.number?.trim();
  const providerNumber = readString(card.cardNumber) ?? undefined;
  if (requestedNumber && providerNumber && !collectorNumberMatches(providerNumber, requestedNumber)) return false;

  const providerSet = readString(card.set?.name) ?? "";
  if (request.setName && providerSet && !setMatchesRequest(providerSet, request.setName)) return false;

  return true;
}

function pokeTraceProviderMentionsFirstEdition(card: PokeTraceCard): boolean {
  return [card.name, card.set?.name].some((value) => textMentionsFirstEdition(readString(value)));
}

function setMatchesRequest(providerSet: string, requestedSet: string): boolean {
  const normalizedProviderSet = stripProviderSetCodePrefix(providerSet);
  const normalizedRequestedSet = stripProviderSetCodePrefix(requestedSet);
  const requestedTokens = tokenizeSearchText(normalizedRequestedSet)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3 && !["set", "promo", "promos", "pokemon", "card"].includes(token));
  const providerTokens = tokenizeSearchText(normalizedProviderSet)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3 && !["set", "promo", "promos", "pokemon", "card"].includes(token));
  if (requestedTokens.length === 0 || providerTokens.length === 0) return true;

  const matchingTokens = requestedTokens.filter((token) =>
    providerTokens.some((candidate) => tokenMatches(token, candidate)),
  );
  const providerSubsetMatchesRequested =
    providerTokens.length >= 2 &&
    providerTokens.every((providerToken) =>
      requestedTokens.some((requestedToken) => tokenMatches(requestedToken, providerToken)),
    );
  if (requestedTokens.length > providerTokens.length && providerSubsetMatchesRequested) {
    return true;
  }
  if (requestedTokens.length <= 2) {
    return matchingTokens.length === requestedTokens.length;
  }

  const candidates = [normalizedRequestedSet];
  const resolvedSetId = resolveSetId(normalizedRequestedSet);
  const resolvedSet = resolvedSetId ? getSetById(resolvedSetId) : undefined;
  if (resolvedSet?.name) candidates.push(resolvedSet.name);
  if (resolvedSet?.ptcgoCode) candidates.push(resolvedSet.ptcgoCode);

  return matchingTokens.length >= Math.ceil(requestedTokens.length * 0.6) || candidates.some((candidate) => tokensMatch(candidate, normalizedProviderSet));
}

function tokensMatch(needle: string, haystack: string): boolean {
  const needleTokens = tokenizeSearchText(needle).map(singularizeToken).filter((token) => token !== "set");
  const haystackTokens = tokenizeSearchText(haystack).map(singularizeToken);
  if (needleTokens.length === 0) return true;
  if (haystackTokens.length === 0) return false;
  return needleTokens.every((needleToken) =>
    haystackTokens.some((haystackToken) => tokenMatches(needleToken, haystackToken)),
  );
}

function collectorNumberMatches(providerNumber: string, requestedNumber: string): boolean {
  return collectorNumbersEquivalent(providerNumber, requestedNumber);
}

function stripPromoCollectorPrefix(number: string | undefined): string | null {
  const normalized = number?.trim().toUpperCase().replace(/\s+/g, "");
  const match = normalized?.match(/^(?:SVP|MEP|SWSH|SM|XY|BW|DP|HGSS)(\d{1,4})$/);
  if (!match) return null;
  return match[1]!;
}

function stripLeadingZeros(value: string | null | undefined): string | null {
  return stripLeadingZerosFromNumericSegment(value);
}

function singularizeToken(token: string): string {
  return token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token;
}

function priceToGbpPence(value: unknown, currency: "USD" | "EUR", rates: FxRates): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? toGbpPence(n, currency, rates) : 0;
}

function readCurrency(value: unknown): "USD" | "EUR" | null {
  return value === "USD" || value === "EUR" ? value : null;
}

function readPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function readPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseDate(value: unknown): string {
  const date = new Date(typeof value === "string" ? value : Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function trendPct(tier: PokeTracePriceTier): number | null {
  const current = Number(tier.avg);
  const older = Number(tier.avg30d ?? tier.avg7d);
  if (!Number.isFinite(current) || !Number.isFinite(older) || older <= 0) return null;
  return Math.round(((current - older) / older) * 1000) / 10;
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForSharedPokeTraceSlot(intervalMs: number): Promise<void> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return Promise.resolve();
  const wait = sharedPokeTraceQueue.then(async () => {
    const elapsed = Date.now() - sharedPokeTraceRequestAt;
    const remaining = intervalMs - elapsed;
    if (remaining > 0) await sleep(remaining);
    sharedPokeTraceRequestAt = Date.now();
  });
  sharedPokeTraceQueue = wait.catch(() => undefined);
  return wait;
}

function retryDelayMs(res: Response, rateLimitCount: number): number {
  const retryAfter = res.headers.get("Retry-After");
  const parsed = parseRetryAfterMs(retryAfter);
  if (parsed != null) return parsed;
  return rateLimitCount <= 1 ? 1000 : 4000;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function readPokeTraceCooldown(now = Date.now()): string | null {
  if (sharedPokeTraceCooldownUntil <= now) return null;
  return sharedPokeTraceCooldownReason === "forbidden" ? "key problem" : "rate limited";
}

function readPokeTraceMarketDeny(market: PokeTraceMarket, now = Date.now()): string | null {
  const until = sharedPokeTraceMarketDeniedUntil[market] ?? 0;
  return until > now ? "market not permitted" : null;
}

function enterPokeTraceMarketDeny(market: PokeTraceMarket, now = Date.now()): void {
  sharedPokeTraceMarketDeniedUntil[market] = now + MARKET_DENY_TTL_MS;
}

function enterPokeTraceCooldown(reason: "rate-limit" | "forbidden", cooldownMs: number): void {
  const now = Date.now();
  if (
    reason === "forbidden" &&
    sharedPokeTraceHadForbiddenCooldown &&
    sharedPokeTraceCooldownReason === "forbidden" &&
    sharedPokeTraceCooldownUntil <= now
  ) {
    sharedPokeTracePersistentKeyProblem = true;
  }
  if (reason === "forbidden") sharedPokeTraceHadForbiddenCooldown = true;
  sharedPokeTraceCooldownReason = reason;
  sharedPokeTraceCooldownUntil = now + Math.max(0, cooldownMs);
  sharedPokeTraceStats.cooldowns += 1;
}

function emptyPokeTraceStats(): PokeTraceStats {
  return { calls: 0, rateLimited: 0, forbidden: 0, cooldowns: 0 };
}

function isPokeTraceMarket(value: unknown): value is PokeTraceMarket {
  return value === "US" || value === "EU";
}

function markPokeTracePayloadMarket(payload: unknown, market: PokeTraceMarket): unknown {
  const root = payload as PokeTracePayload | null;
  const data = root?.data;
  if (Array.isArray(data)) {
    return { ...(root as Record<string, unknown>), data: data.map((card) => ({ ...card, market })) };
  }
  if (data && typeof data === "object") {
    return { ...(root as Record<string, unknown>), data: { ...(data as Record<string, unknown>), market } };
  }
  return payload;
}
