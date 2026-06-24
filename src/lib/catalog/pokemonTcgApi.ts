import type { CardRef } from "../domain/types.js";
import { STATIC_RATES, toGbpPence, type FxRates } from "../comps/currency.js";
import { isApiUnavailableSetId, resolveSetIdForCard } from "./setCatalog.js";
import type { CatalogCard, CatalogPriceSignal, CatalogSource } from "./types.js";
import { tokenizeSearchText } from "./fuzzy.js";
import { normalizeCatalogCardSearchInput } from "./cardSearch.js";

const BASE_URL = "https://api.pokemontcg.io/v2";
const CARD_IDENTITY_FIELDS = "id,name,number,rarity,images,set";
const MARKET_SELECT_FIELDS = `${CARD_IDENTITY_FIELDS},tcgplayer,cardmarket`;
const DEFAULT_FETCH_TIMEOUT_MS = 6500;
const REQUEST_CACHE_TTL_MS = 30 * 60 * 1000;
const NULL_CACHE_TTL_MS = 60 * 1000;

type FetchLike = typeof fetch;
type RequestCacheEntry = {
  value: unknown;
  expiresAt: number;
};

const requestCache = new Map<string, RequestCacheEntry>();

type PokemonTcgSet = {
  id?: unknown;
  name?: unknown;
  printedTotal?: unknown;
  total?: unknown;
  images?: { symbol?: unknown; logo?: unknown };
};

type PokemonTcgCardPayload = {
  id?: unknown;
  name?: unknown;
  number?: unknown;
  rarity?: unknown;
  images?: { small?: unknown; large?: unknown };
  set?: PokemonTcgSet;
  tcgplayer?: {
    url?: unknown;
    updatedAt?: unknown;
    prices?: Record<string, Record<string, unknown>>;
  };
  cardmarket?: {
    url?: unknown;
    updatedAt?: unknown;
    prices?: Record<string, unknown>;
  };
};

export class PokemonTcgApiCatalogSource implements CatalogSource {
  readonly name = "pokemon-tcg-api";
  readonly live: boolean;

  constructor(
    private readonly apiKey: string | undefined = process.env.POKEMON_TCG_API_KEY,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl: string = BASE_URL,
    private readonly fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  ) {
    this.live = Boolean(apiKey?.trim());
  }

  async resolve(card: CardRef): Promise<CatalogCard | null> {
    if ((card.game && card.game !== "POKEMON") || (card.language && card.language !== "EN")) {
      return null;
    }

    if (card.tcgApiId) {
      const json = await this.request(`/cards/${encodeURIComponent(card.tcgApiId)}`, {
        select: MARKET_SELECT_FIELDS,
      });
      return mapPokemonTcgCard(readDataObject(json));
    }

    for (const candidateId of buildPokemonTcgIdCandidates(card)) {
      const json = await this.request(`/cards/${encodeURIComponent(candidateId)}`, {
        select: MARKET_SELECT_FIELDS,
      });
      const direct = mapPokemonTcgCard(readDataObject(json));
      if (direct) return direct;
    }

    const queries = buildPokemonTcgSearchQueries(card);
    if (queries.length === 0) return null;

    const resolvedSetId = resolveSetIdForCard(card.setName, card.number);

    // Progressive relaxation: try the most specific query first (name +
    // number + set), then fall back through looser combinations. This is
    // what fixes the "Charizard 04/102 + base set" style bug -- previously
    // a single rigid AND query meant any one mismatched term (a stray
    // leading zero, a set nickname the API's phrase match couldn't parse)
    // zeroed out the whole search. Now one bad term just drops a level
    // instead of failing outright.
    for (const q of queries) {
      const json = await this.request("/cards", {
        q,
        pageSize: "10",
        select: MARKET_SELECT_FIELDS,
      });
      const cards = readDataArray(json);
      if (cards.length > 0) {
        return pickBestPokemonTcgCard(cards, card, resolvedSetId);
      }
    }
    return null;
  }

  async search(card: CardRef, limit = 10): Promise<CatalogCard[]> {
    if ((card.game && card.game !== "POKEMON") || (card.language && card.language !== "EN")) {
      return [];
    }

    const queries = buildPokemonTcgSearchQueries(card);
    if (queries.length === 0) return [];
    const resolvedSetId = resolveSetIdForCard(card.setName, card.number);

    for (const q of queries) {
      const json = await this.request("/cards", {
        q,
        pageSize: String(Math.min(Math.max(limit, 1), 25)),
        select: CARD_IDENTITY_FIELDS,
      });
      const cards = rankPokemonTcgCards(readDataArray(json), card, resolvedSetId);
      if (cards.length > 0) return cards.slice(0, limit);
    }
    return [];
  }

  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    try {
      const url = new URL(`${this.baseUrl}${path}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const cacheKey = this.cacheKey(url);
      const cached = cacheKey ? readCachedRequest(cacheKey) : undefined;
      if (cached !== undefined) return cached;

      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.apiKey?.trim()) {
        headers["X-Api-Key"] = this.apiKey.trim();
      }

      const res = await this.fetchImpl(url, { headers, signal: timeoutSignal(this.fetchTimeoutMs) });
      const value = res.ok ? await res.json() : null;
      if (cacheKey) writeCachedRequest(cacheKey, value);
      return value;
    } catch {
      return null;
    }
  }

  private cacheKey(url: URL): string | null {
    const select = url.searchParams.get("select") ?? "";
    if (select.includes("tcgplayer") || select.includes("cardmarket")) {
      return null;
    }
    return this.baseUrl === BASE_URL ? url.toString() : null;
  }
}

function readCachedRequest(key: string): unknown | undefined {
  const cached = requestCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    requestCache.delete(key);
    return undefined;
  }
  return cached.value;
}

function writeCachedRequest(key: string, value: unknown): void {
  const ttl = value == null ? NULL_CACHE_TTL_MS : REQUEST_CACHE_TTL_MS;
  requestCache.set(key, { value, expiresAt: Date.now() + ttl });
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
}

// Builds a list of progressively looser search queries, most specific
// first. The Pokemon TCG API ANDs every term in `q`, so a single rigid
// query means one mismatched term (a set nickname that doesn't tokenize
// the way the API expects, a number formatted slightly differently)
// zeroes out the whole search. Trying each level in order until one
// returns results is what makes the search forgiving instead of brittle.
//
// Set names are resolved to a canonical `set.id` via the bundled
// setCatalog rather than queried as `set.name:"<phrase>"` -- phrase
// queries require near-exact wording (e.g. "base set" won't match the
// API's literal set name "Base"), whereas `set.id:base1` is an exact,
// unambiguous match once resolved.
export function buildPokemonTcgSearchQueries(card: CardRef): string[] {
  const normalized = normalizeCatalogCardSearchInput(card.name, card.setName);
  const name = (normalized.name || card.name).trim();
  if (!name) return [];
  const nameTerm = `name:${quoteQueryValue(name)}`;
  const relaxedNameTerm = buildRelaxedNameTerm(name);
  const lookupCard = {
    ...card,
    name,
    setName: card.setName ?? normalized.setName,
    number: card.number ?? normalized.number,
  };

  const numberTerms = buildPokemonTcgCollectorNumberTerms(lookupCard.number).map(
    (number) => `number:${quoteQueryValue(number)}`,
  );

  const resolvedSetId = resolveSetIdForCard(lookupCard.setName, lookupCard.number);
  const setTerm = resolvedSetId ? `set.id:${resolvedSetId}` : undefined;
  const strictPromoLookup = shouldKeepPromoLookupStrict(lookupCard, resolvedSetId);

  const queries: string[] = [];
  const seen = new Set<string>();
  const addQuery = (...terms: Array<string | undefined>) => {
    const query = terms.filter((term): term is string => Boolean(term)).join(" ");
    if (query && !seen.has(query)) {
      seen.add(query);
      queries.push(query);
    }
  };

  for (const numberTerm of numberTerms) {
    addQuery(nameTerm, numberTerm, setTerm);
  }
  if (relaxedNameTerm) {
    for (const numberTerm of numberTerms) {
      addQuery(relaxedNameTerm, numberTerm, setTerm);
    }
  }
  if (setTerm) {
    addQuery(nameTerm, setTerm);
    if (relaxedNameTerm) addQuery(relaxedNameTerm, setTerm);
  }

  if (strictPromoLookup) return queries;

  for (const numberTerm of numberTerms) {
    addQuery(nameTerm, numberTerm);
  }
  if (relaxedNameTerm) {
    for (const numberTerm of numberTerms) {
      addQuery(relaxedNameTerm, numberTerm);
    }
  }
  addQuery(nameTerm);

  return queries;
}

/** @deprecated kept for backwards compatibility/tests; returns the most specific query. */
export function buildPokemonTcgSearchQuery(card: CardRef): string {
  return buildPokemonTcgSearchQueries(card)[0] ?? "";
}

export function mapPokemonTcgCard(card: unknown): CatalogCard | null {
  const payload = card as PokemonTcgCardPayload | null;
  const id = readString(payload?.id);
  const name = readString(payload?.name);
  const setName = readString(payload?.set?.name);
  if (!id || !name || !setName) return null;

  const apiNumber = readString(payload?.number);
  const printedTotal = readPositiveInt(payload?.set?.printedTotal) ?? readPositiveInt(payload?.set?.total);
  const number = apiNumber ? formatCollectorNumber(apiNumber, printedTotal, payload?.set) : undefined;

  return {
    game: "POKEMON",
    language: "EN",
    name,
    setName,
    setCode: readString(payload?.set?.id),
    number,
    rarity: readString(payload?.rarity),
    imageUrl: readString(payload?.images?.large) ?? readString(payload?.images?.small),
    setLogoUrl: readString(payload?.set?.images?.logo),
    setSymbolUrl: readString(payload?.set?.images?.symbol),
    tcgApiId: id,
    priceSignals: readCatalogPriceSignals(payload),
  };
}

export function pickCatalogPriceSignal(signals: CatalogPriceSignal[] | undefined): CatalogPriceSignal | null {
  if (!signals || signals.length === 0) return null;
  return [...signals].sort((a, b) => priceSignalPriority(b) - priceSignalPriority(a))[0] ?? null;
}

function readCatalogPriceSignals(
  payload: PokemonTcgCardPayload | null,
  rates: FxRates = STATIC_RATES,
): CatalogPriceSignal[] | undefined {
  const signals: CatalogPriceSignal[] = [];
  const tcgplayer = payload?.tcgplayer;
  const tcgUpdatedAt = readString(tcgplayer?.updatedAt);
  const tcgUrl = readString(tcgplayer?.url);
  const tcgPrices = tcgplayer?.prices ?? {};
  const tcgVariantPriority = ["holofoil", "normal", "1stEditionHolofoil", "1stEditionNormal", "reverseHolofoil"];
  for (const variant of tcgVariantPriority) {
    const price = tcgPrices[variant];
    if (!price) continue;
    for (const kind of ["market", "mid", "low", "directLow"]) {
      const amount = readPositiveNumber(price[kind]);
      if (amount == null) continue;
      signals.push({
        source: "tcgplayer",
        label: `TCGPlayer ${formatPriceLabel(variant)} ${kind}`,
        pricePence: toGbpPence(amount, "USD", rates),
        originalAmount: amount,
        originalCurrency: "USD",
        kind,
        variant,
        updatedAt: tcgUpdatedAt,
        url: tcgUrl,
      });
    }
  }

  const cardmarket = payload?.cardmarket;
  const cmUpdatedAt = readString(cardmarket?.updatedAt);
  const cmUrl = readString(cardmarket?.url);
  const cmPrices = cardmarket?.prices ?? {};
  for (const kind of ["trendPrice", "averageSellPrice", "avg30", "avg7", "lowPriceExPlus", "lowPrice"]) {
    const amount = readPositiveNumber(cmPrices[kind]);
    if (amount == null) continue;
    signals.push({
      source: "cardmarket",
      label: `Cardmarket ${formatPriceLabel(kind)}`,
      pricePence: toGbpPence(amount, "EUR", rates),
      originalAmount: amount,
      originalCurrency: "EUR",
      kind,
      updatedAt: cmUpdatedAt,
      url: cmUrl,
    });
  }

  return signals.length > 0
    ? signals.sort((a, b) => priceSignalPriority(b) - priceSignalPriority(a))
    : undefined;
}

export function pickBestPokemonTcgCard(
  cards: unknown[],
  target: CardRef,
  resolvedSetId?: string,
): CatalogCard | null {
  return rankPokemonTcgCards(cards, target, resolvedSetId)[0] ?? null;
}

export function rankPokemonTcgCards(
  cards: unknown[],
  target: CardRef,
  resolvedSetId?: string,
): CatalogCard[] {
  return cards
    .map(mapPokemonTcgCard)
    .filter((card): card is CatalogCard => card != null)
    .sort((a, b) => scoreCatalogCard(b, target, resolvedSetId) - scoreCatalogCard(a, target, resolvedSetId));
}

export function normalizeCollectorNumber(number: string | undefined): string | undefined {
  const trimmed = number?.trim();
  if (!trimmed) return undefined;
  const beforeSlash = trimmed.split("/")[0]?.trim() || trimmed;
  // Pure-digit collector numbers are stored by the API without leading
  // zeros (e.g. "4", not "04"), across both vintage and modern sets.
  // Alphanumeric-prefixed numbers (TG05, SWSH001) keep their padding as
  // part of the code and must be preserved verbatim.
  if (/^\d+$/.test(beforeSlash)) {
    return String(Number.parseInt(beforeSlash, 10));
  }
  return beforeSlash;
}

export function buildPokemonTcgCollectorNumberTerms(number: string | undefined): string[] {
  const normalized = normalizeCollectorNumber(number);
  if (!normalized) return [];

  const terms = [normalized];
  const strippedPromo = stripPromoPrefixForApiNumber(normalized);
  if (strippedPromo && strippedPromo !== normalized) terms.push(strippedPromo);
  return terms;
}

export function buildPokemonTcgIdCandidates(card: CardRef): string[] {
  const setId = resolveSetIdForCard(card.setName, card.number);
  if (!setId) return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const number of buildPokemonTcgCollectorNumberTerms(card.number)) {
    const id = `${setId}-${number}`;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function formatCollectorNumber(
  number: string,
  printedTotal: number | undefined,
  set: PokemonTcgSet | undefined,
): string {
  const promoNumber = formatPromoCollectorNumber(number, set);
  if (promoNumber) return promoNumber;
  if (number.includes("/") || !printedTotal) return number;
  const prefixed = number.match(/^([A-Za-z]{1,4})\d+$/);
  if (prefixed) {
    const prefix = prefixed[1]!.toUpperCase();
    return shouldMirrorPrefixInPrintedTotal(prefix, set)
      ? `${number}/${prefix}${printedTotal}`
      : number;
  }
  return `${number}/${printedTotal}`;
}

function buildRelaxedNameTerm(name: string): string | undefined {
  const tokens = tokenizeSearchText(name);
  const firstUsefulToken = tokens.find((token) => token.length >= 3);
  if (!firstUsefulToken || tokens.length <= 1) return undefined;
  return `name:${firstUsefulToken}`;
}

function shouldKeepPromoLookupStrict(card: CardRef, resolvedSetId: string | undefined): boolean {
  if (isApiUnavailableSetId(resolvedSetId)) return true;
  const setText = card.setName?.trim() ?? "";
  if (setText && !resolvedSetId && /\bpromos?\b/i.test(setText)) return true;
  return Boolean(card.number && /^[A-Za-z]{2,5}\s*0?\d{1,4}/.test(card.number.trim()) && !resolvedSetId);
}

function stripPromoPrefixForApiNumber(number: string): string | undefined {
  const match = number.match(/^(?:SVP|MEP)0*(\d{1,4})$/i);
  if (!match) return undefined;
  return String(Number.parseInt(match[1]!, 10));
}

function formatPromoCollectorNumber(number: string, set: PokemonTcgSet | undefined): string | null {
  const setId = readString(set?.id)?.toLowerCase();
  if (setId === "svp" && /^\d+$/.test(number)) {
    return `SVP${number.padStart(3, "0")}`;
  }
  if (setId === "mep" && /^\d+$/.test(number)) {
    return `MEP${number.padStart(3, "0")}`;
  }
  return null;
}

function shouldMirrorPrefixInPrintedTotal(prefix: string, set: PokemonTcgSet | undefined): boolean {
  const setName = readString(set?.name)?.toLowerCase() ?? "";
  return (
    ["TG", "GG", "SV", "RC"].includes(prefix) ||
    setName.includes("trainer gallery") ||
    setName.includes("galarian gallery") ||
    setName.includes("shiny vault") ||
    setName.includes("radiant collection")
  );
}

function scoreCatalogCard(card: CatalogCard, target: CardRef, resolvedSetId?: string): number {
  let score = 0;
  if (sameText(card.tcgApiId, target.tcgApiId)) score += 100;
  if (sameText(card.name, target.name)) score += 50;

  const targetNumber = normalizeCollectorNumber(target.number);
  const cardNumber = normalizeCollectorNumber(card.number);
  if (targetNumber && sameText(cardNumber, targetNumber)) score += 30;

  // Prefer matching against the resolved set.id when we have one -- it's
  // an exact, unambiguous identifier. Deliberately NOT a substring/
  // includes() check: that previously rewarded wrong-but-related sets
  // (e.g. "Base Set 2", "Expedition Base Set") for merely containing the
  // query text "base set", even though the correct set ("Base") doesn't
  // contain that phrase at all. Exact comparisons only.
  if (resolvedSetId && sameText(card.setCode, resolvedSetId)) {
    score += 25;
  } else {
    const setName = target.setName?.trim();
    if (setName && (sameText(card.setName, setName) || sameText(card.setCode, setName))) {
      score += 25;
    }
  }

  return score;
}

function quoteQueryValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function readDataObject(json: unknown): unknown {
  const root = json as { data?: unknown } | null;
  return root?.data ?? null;
}

function readDataArray(json: unknown): unknown[] {
  const root = json as { data?: unknown } | null;
  return Array.isArray(root?.data) ? root.data : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function priceSignalPriority(signal: CatalogPriceSignal): number {
  const sourceBase = signal.source === "cardmarket" ? 1000 : 700;
  const kindPriority: Record<string, number> = {
    trendPrice: 90,
    averageSellPrice: 85,
    avg30: 82,
    avg7: 78,
    market: 75,
    mid: 55,
    lowPriceExPlus: 45,
    lowPrice: 38,
    low: 35,
    directLow: 30,
  };
  const variantPriority: Record<string, number> = {
    holofoil: 20,
    normal: 18,
    "1stEditionHolofoil": 10,
    "1stEditionNormal": 8,
    reverseHolofoil: 4,
  };
  return sourceBase + (kindPriority[signal.kind] ?? 0) + (variantPriority[signal.variant ?? ""] ?? 0);
}

function formatPriceLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^1st/, "1st ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  return a != null && b != null && a.trim().toLowerCase() === b.trim().toLowerCase();
}
