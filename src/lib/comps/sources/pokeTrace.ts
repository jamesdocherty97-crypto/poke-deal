import type { CardRef, CompQuery, CompResult, Grade } from "../../domain/types.js";
import { getSetById, resolveSetId } from "../../catalog/setCatalog.js";
import { tokenizeSearchText, tokenMatches } from "../../catalog/fuzzy.js";
import type { CompSource } from "../CompSource.js";
import { DEFAULT_WINDOW_DAYS } from "../cleaning.js";
import { STATIC_RATES, toGbpPence, type FxRates } from "../currency.js";
import { requestsFirstEdition, textMentionsFirstEdition } from "../variants.js";

const BASE_URL = "https://api.poketrace.com/v1";
const DEFAULT_FETCH_TIMEOUT_MS = 2200;
// Free tier allows only 1 request / 2s. The EU-first then US fallback fires two
// requests, so without spacing the second call is rate-limited (429) and PokeTrace
// silently returns nothing. We pause before the fallback market to clear the burst
// window. Pro tier usually returns on the first (EU) call, so this delay rarely fires.
const DEFAULT_INTER_MARKET_DELAY_MS = 2100;
const MARKET_FALLBACKS: PokeTraceMarket[] = ["EU", "US"];
let sharedPokeTraceRequestAt = 0;
let sharedPokeTraceQueue = Promise.resolve();

type PokeTraceMarket = "US" | "EU";

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
  ) {
    this.live = Boolean(apiKey && apiKey.trim().length > 0);
  }

  async lookup(card: CardRef, query: CompQuery = {}): Promise<CompResult> {
    const grade = query.grade ?? "RAW";
    const windowDays = query.windowDays ?? DEFAULT_WINDOW_DAYS;
    const ctx = { source: this.name, card, grade, windowDays };
    if (!this.live) return emptyComp(ctx, "PokeTrace key missing");

    let lastEmpty: CompResult | null = null;
    for (let i = 0; i < MARKET_FALLBACKS.length; i += 1) {
      const market = MARKET_FALLBACKS[i]!;
      // Respect the free-tier 1-req/2s burst limit before the fallback market call.
      if (i > 0 && this.interMarketDelayMs > 0) await sleep(this.interMarketDelayMs);
      const payload = await this.fetchCards(card, market);
      const comp = payload == null
        ? emptyComp(ctx, `PokeTrace ${market} lookup failed or returned no response`)
        : mapPokeTraceCardsToComp(payload, ctx);
      if (comp.sampleSize > 0 && comp.medianPence > 0) return comp;
      lastEmpty = comp;
    }

    return lastEmpty ?? emptyComp(ctx, "PokeTrace lookup failed or returned no response");
  }

  private async fetchCards(card: CardRef, market: PokeTraceMarket): Promise<unknown | null> {
    for (const search of buildPokeTraceSearchVariants(card)) {
      const params = new URLSearchParams({
        search,
        market,
        product_type: "single",
        limit: "3",
      });

      try {
        if (this.useSharedThrottle) await waitForSharedPokeTraceSlot(this.interMarketDelayMs);
        const res = await this.fetchImpl(`${BASE_URL}/cards?${params.toString()}`, {
          headers: { "X-API-Key": this.apiKey ?? "", Accept: "application/json" },
          signal: timeoutSignal(this.fetchTimeoutMs),
        });
        if (!res.ok) {
          console.warn(`[${this.name}] HTTP ${res.status} - no comp returned`);
          if (res.status === 403) break;
          continue;
        }
        const json = (await res.json()) as unknown;
        if (findMatchingPokeTraceCard(json, card)) return json;
      } catch (err) {
        console.warn(`[${this.name}] fetch failed: ${(err as Error).message}`);
      }
    }

    return null;
  }
}

export function resetPokeTraceSharedThrottleForTests(): void {
  sharedPokeTraceRequestAt = 0;
  sharedPokeTraceQueue = Promise.resolve();
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

function chooseTier(card: PokeTraceCard, grade: Grade): PokeTraceTierChoice | null {
  const tierKey = gradeToPokeTraceTier(grade);
  if (grade === "RAW") {
    const cardmarket = card.prices?.cardmarket?.[tierKey] ?? card.prices?.cardmarket_unsold?.[tierKey];
    if (cardmarket) return { tier: cardmarket, tierKey, priceSource: "cardmarket", kind: "market-baseline" };
    const tcgplayer = card.prices?.tcgplayer?.[tierKey];
    if (tcgplayer) return { tier: tcgplayer, tierKey, priceSource: "tcgplayer", kind: "market-baseline" };
    const ebay = card.prices?.ebay?.[tierKey];
    if (ebay) return { tier: ebay, tierKey, priceSource: "ebay", kind: "sold-aggregate" };
    return null;
  }

  const ebay = card.prices?.ebay?.[tierKey];
  if (ebay) return { tier: ebay, tierKey, priceSource: "ebay", kind: "sold-aggregate" };
  const cardmarket = card.prices?.cardmarket_unsold?.[tierKey];
  if (cardmarket) return { tier: cardmarket, tierKey, priceSource: "cardmarket_unsold", kind: "market-baseline" };
  return null;
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

function providerCardRef(card: PokeTraceCard): CardRef {
  return {
    name: readString(card.name) ?? "Unknown card",
    setName: readString(card.set?.name) ?? undefined,
    number: readString(card.cardNumber) ?? undefined,
    game: "POKEMON",
    language: "EN",
  };
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
  const requestedTokens = tokenizeSearchText(requestedSet)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3 && !["set", "promo", "promos", "pokemon", "card"].includes(token));
  const providerTokens = tokenizeSearchText(providerSet)
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

  const candidates = [requestedSet];
  const resolvedSetId = resolveSetId(requestedSet);
  const resolvedSet = resolvedSetId ? getSetById(resolvedSetId) : undefined;
  if (resolvedSet?.name) candidates.push(resolvedSet.name);
  if (resolvedSet?.ptcgoCode) candidates.push(resolvedSet.ptcgoCode);

  return matchingTokens.length >= Math.ceil(requestedTokens.length * 0.6) || candidates.some((candidate) => tokensMatch(candidate, providerSet));
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
  const providerForms = collectorNumberForms(providerNumber);
  const requestedForms = collectorNumberForms(requestedNumber);
  return [...requestedForms].some((requested) => providerForms.has(requested));
}

function collectorNumberForms(number: string): Set<string> {
  const normalized = normalizeComparableCollectorNumber(number);
  const left = normalized.split("/")[0] ?? normalized;
  const stripped = stripPromoCollectorPrefix(left);
  const strippedLeading = stripLeadingZeros(left);
  return new Set(
    [normalized, left, stripped, stripped ? normalizeComparableCollectorNumber(stripped) : null, strippedLeading].filter(
      (value): value is string => Boolean(value),
    ),
  );
}

function normalizeComparableCollectorNumber(number: string): string {
  return number
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .split("/")
    .map((part) => part.replace(/^0+(\d)/, "$1"))
    .join("/");
}

function stripPromoCollectorPrefix(number: string | undefined): string | null {
  const normalized = number?.trim().toUpperCase().replace(/\s+/g, "");
  const match = normalized?.match(/^(?:SVP|MEP|SWSH|SM|XY|BW|DP|HGSS)(\d{1,4})$/);
  if (!match) return null;
  return match[1]!;
}

function stripLeadingZeros(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^\d+$/);
  if (!match) return null;
  const normalized = String(Number.parseInt(match[0], 10));
  return normalized !== "NaN" ? normalized : null;
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
