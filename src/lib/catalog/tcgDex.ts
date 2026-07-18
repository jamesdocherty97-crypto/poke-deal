import type { CardRef } from "../domain/types.js";
import { catalogCardMatchesLookupContext, rankCatalogCards } from "./cardSearch.js";
import { normalizeSearchText } from "./fuzzy.js";
import { getSetById, resolveSetIdForCard } from "./setCatalog.js";
import { createAbortScope } from "../http/abortScope.js";
import type { CatalogCard, CatalogSource, CatalogSourceContext } from "./types.js";
import { fetchReadWithRetry } from "../http/fetchReadWithRetry.js";

const BASE_URL = "https://api.tcgdex.net/v2/en";
const DEFAULT_FETCH_TIMEOUT_MS = 6500;
const REQUEST_CACHE_TTL_MS = 30 * 60 * 1000;

type FetchLike = typeof fetch;
type RequestCacheEntry = {
  value: unknown;
  expiresAt: number;
};

type TcgDexSetBrief = {
  id?: unknown;
  name?: unknown;
  logo?: unknown;
  symbol?: unknown;
  cardCount?: { official?: unknown; total?: unknown };
};

type TcgDexSetPayload = TcgDexSetBrief & {
  serie?: { id?: unknown; name?: unknown };
  releaseDate?: unknown;
  cards?: TcgDexCardBrief[];
};

type TcgDexCardBrief = {
  id?: unknown;
  localId?: unknown;
  name?: unknown;
  image?: unknown;
};

type TcgDexCardPayload = TcgDexCardBrief & {
  rarity?: unknown;
  set?: TcgDexSetBrief;
};

const requestCache = new Map<string, RequestCacheEntry>();

const TCGDEX_SET_ID_BY_POKEMON_TCG_ID: Record<string, string> = {
  sv3pt5: "sv03.5",
  sv4pt5: "sv04.5",
  sv6pt5: "sv06.5",
  sv8pt5: "sv08.5",
  zsv10pt5: "sv10.5b",
  rsv10pt5: "sv10.5w",
  me1: "me01",
  me2: "me02",
  me2pt5: "me02.5",
  me3: "me03",
  me4: "me04",
};

export class TcgDexCatalogSource implements CatalogSource {
  readonly name = "tcgdex";
  readonly live = true;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl: string = BASE_URL,
    private readonly fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  ) {}

  async resolve(card: CardRef, context: CatalogSourceContext = {}): Promise<CatalogCard | null> {
    if (card.game && card.game !== "POKEMON") {
      return null;
    }
    const language = card.language ?? "EN";

    if (card.tcgDexId) {
      const direct = mapTcgDexCard(await this.request(`/cards/${encodeURIComponent(card.tcgDexId)}`, {}, context.signal, language), language);
      return direct && catalogCardMatchesLookupContext(direct, card) ? direct : null;
    }

    const exact = await this.resolveBySetNumber(card, context.signal);
    if (exact) return exact;

    return (await this.search(card, 1, context))[0] ?? null;
  }

  async search(card: CardRef, limit = 10, context: CatalogSourceContext = {}): Promise<CatalogCard[]> {
    if (card.game && card.game !== "POKEMON") {
      return [];
    }
    const language = card.language ?? "EN";

    const name = card.name.trim();
    if (!name) return [];

    const payload = await this.request("/cards", { name }, context.signal, language);
    const briefs = Array.isArray(payload) ? payload : [];
    const setHint = await this.resolveTcgDexSetId(card.setName, card.number, context.signal, language);
    const detailed = await Promise.all(
      briefs
        .filter((brief) => {
          const id = readString((brief as TcgDexCardBrief).id);
          return !setHint || id?.startsWith(`${setHint}-`);
        })
        .slice(0, Math.max(limit * 4, 12))
        .map((brief) => this.resolveBrief(brief, context.signal, language)),
    );

    return rankCatalogCards(name, detailed.filter((item): item is CatalogCard => Boolean(item)), {
      setName: card.setName,
      limit,
    }).filter((candidate) => catalogCardMatchesLookupContext(candidate, card));
  }

  async listPhysicalSets(): Promise<TcgDexSetPayload[]> {
    const payload = await this.request("/sets");
    if (!Array.isArray(payload)) return [];

    const sets = await Promise.all(
      payload
        .map((set) => readString((set as TcgDexSetBrief).id))
        .filter((id): id is string => Boolean(id))
        .map((id) => this.fetchSet(id)),
    );

    return sets.filter((set): set is TcgDexSetPayload => Boolean(set && isPhysicalPokemonSet(set)));
  }

  private async resolveBySetNumber(card: CardRef, signal?: AbortSignal): Promise<CatalogCard | null> {
    const language = card.language ?? "EN";
    const setId = await this.resolveTcgDexSetId(card.setName, card.number, signal, language);
    const localId = tcgDexLocalId(card.number, setId);
    if (!setId || !localId) return null;

    const direct = mapTcgDexCard(await this.request(`/sets/${encodeURIComponent(setId)}/${encodeURIComponent(localId)}`, {}, signal, language), language);
    if (!direct || !catalogCardMatchesLookupContext(direct, card)) return null;
    return direct;
  }

  private async resolveBrief(brief: unknown, signal?: AbortSignal, language: CardRef["language"] = "EN"): Promise<CatalogCard | null> {
    const id = readString((brief as TcgDexCardBrief | null)?.id);
    if (!id) return null;
    return mapTcgDexCard(await this.request(`/cards/${encodeURIComponent(id)}`, {}, signal, language), language);
  }

  private async resolveTcgDexSetId(setName: string | undefined, number: string | undefined, signal?: AbortSignal, language: CardRef["language"] = "EN"): Promise<string | undefined> {
    const pokemonSetId = resolveSetIdForCard(setName, number);
    if (pokemonSetId) {
      return TCGDEX_SET_ID_BY_POKEMON_TCG_ID[pokemonSetId] ?? pokemonSetId;
    }

    const normalizedSetName = normalizeSearchText(setName ?? "");
    if (!normalizedSetName) return undefined;
    if (signal?.aborted) return undefined;
    const payload = await this.request("/sets", {}, signal, language).catch(() => []);
    const sets = Array.isArray(payload) ? payload as TcgDexSetBrief[] : [];
    return sets.find((set) => normalizeSearchText(readString(set.name) ?? "") === normalizedSetName)?.id as string | undefined;
  }

  private async fetchSet(id: string): Promise<TcgDexSetPayload | null> {
    const payload = await this.request(`/sets/${encodeURIComponent(id)}`);
    const setId = readString((payload as TcgDexSetPayload | null)?.id);
    return setId ? (payload as TcgDexSetPayload) : null;
  }

  private async request(path: string, params: Record<string, string> = {}, parentSignal?: AbortSignal, language: CardRef["language"] = "EN"): Promise<unknown> {
    const abort = createAbortScope(parentSignal, this.fetchTimeoutMs);
    try {
      const baseUrl = this.baseUrl === BASE_URL && language === "JP" ? "https://api.tcgdex.net/v2/ja" : this.baseUrl;
      const url = new URL(`${baseUrl}${path}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const cacheKey = url.toString();
      const cached = readCachedRequest(cacheKey);
      if (cached !== undefined) return cached;

      const res = await fetchReadWithRetry(this.fetchImpl, url, { headers: { Accept: "application/json" }, signal: abort.signal }, { totalDeadlineMs: this.fetchTimeoutMs });
      const value = res.ok ? await res.json() : null;
      writeCachedRequest(cacheKey, value);
      return value;
    } catch {
      return null;
    } finally {
      abort.cleanup();
    }
  }
}

export function mapTcgDexSetCards(set: TcgDexSetPayload): CatalogCard[] {
  if (!isPhysicalPokemonSet(set)) return [];
  const setId = readString(set.id);
  const setName = readString(set.name);
  if (!setId || !setName || !Array.isArray(set.cards)) return [];

  return set.cards
    .map((card) => mapTcgDexCard({ ...card, set }))
    .filter((card): card is CatalogCard => Boolean(card));
}

export function mapTcgDexCard(card: unknown, language: CardRef["language"] = "EN"): CatalogCard | null {
  const payload = card as TcgDexCardPayload | null;
  const id = readString(payload?.id);
  const name = readString(payload?.name);
  const localId = readString(payload?.localId);
  const setId = readString(payload?.set?.id) ?? setIdFromCardId(id);
  const setName = readString(payload?.set?.name) ?? setNameFromKnownSet(setId);
  if (!id || !name || !setId || !setName) return null;
  if (isDigitalOnlySetId(setId)) return null;

  return {
    game: "POKEMON",
    language: language ?? "EN",
    name,
    setName: displaySetName(setId, setName),
    setCode: setId,
    number: displayCardNumber(setId, localId),
    rarity: readString(payload?.rarity),
    imageUrl: assetUrl(readString(payload?.image), "card"),
    setLogoUrl: assetUrl(readString(payload?.set?.logo), "set"),
    setSymbolUrl: assetUrl(readString(payload?.set?.symbol), "set"),
    tcgDexId: id,
  };
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
  requestCache.set(key, { value, expiresAt: Date.now() + REQUEST_CACHE_TTL_MS });
}

function tcgDexLocalId(number: string | undefined, setId: string | undefined): string | undefined {
  const trimmed = number?.trim().toUpperCase().replace(/\s+/g, "") ?? "";
  if (!trimmed) return undefined;
  if (setId === "svp") return stripPrefixedNumber(trimmed, "SVP")?.padStart(3, "0");
  if (setId === "mep") return stripPrefixedNumber(trimmed, "MEP")?.padStart(3, "0");
  if (setId === "swshp") return trimmed.startsWith("SWSH") ? trimmed : undefined;
  const beforeSlash = trimmed.split("/")[0] ?? trimmed;
  return beforeSlash;
}

function stripPrefixedNumber(value: string, prefix: string): string | undefined {
  const prefixed = value.match(new RegExp(`^${prefix}0*(\\d{1,4})$`, "i"));
  if (prefixed?.[1]) return prefixed[1];
  const plain = value.match(/^0*(\d{1,4})$/);
  return plain?.[1];
}

function setIdFromCardId(id: string | undefined): string | undefined {
  return id?.split("-").slice(0, -1).join("-");
}

function setNameFromKnownSet(setId: string | undefined): string | undefined {
  if (!setId) return undefined;
  return getSetById(setId)?.name ?? getSetById(reverseMappedPokemonSetId(setId))?.name;
}

function reverseMappedPokemonSetId(tcgDexSetId: string): string {
  return Object.entries(TCGDEX_SET_ID_BY_POKEMON_TCG_ID).find(([, value]) => value === tcgDexSetId)?.[0] ?? tcgDexSetId;
}

function displaySetName(setId: string, setName: string): string {
  if (setId === "svp") return "Scarlet & Violet Black Star Promos";
  if (setId === "mep") return "Mega Evolution Promos";
  return getSetById(reverseMappedPokemonSetId(setId))?.name ?? setName;
}

function displayCardNumber(setId: string, localId: string | undefined): string | undefined {
  if (!localId) return undefined;
  if (setId === "svp") return `SVP${stripPrefixedNumber(localId, "SVP")?.padStart(3, "0") ?? localId}`;
  if (setId === "mep") return `MEP${stripPrefixedNumber(localId, "MEP")?.padStart(3, "0") ?? localId}`;
  return localId;
}

function assetUrl(base: string | undefined, kind: "card" | "set"): string | undefined {
  if (!base) return undefined;
  return kind === "card" ? `${base}/high.webp` : `${base}.webp`;
}

function isPhysicalPokemonSet(set: TcgDexSetPayload): boolean {
  const serieId = readString(set.serie?.id)?.toLowerCase();
  if (serieId === "tcgp") return false;
  const setId = readString(set.id);
  if (!setId || isDigitalOnlySetId(setId)) return false;
  return Boolean(readString(set.name));
}

function isDigitalOnlySetId(setId: string): boolean {
  return /^[A-Z]\d/.test(setId);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
