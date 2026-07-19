import { PokemonTcgApiCatalogSource } from "../catalog/pokemonTcgApi.js";
import {
  catalogCardMatchesLookupContext,
  normalizeCatalogCardSearchInput,
  parseCardSearchQuery,
  rankCatalogCards,
} from "../catalog/cardSearch.js";
import { searchChaseCards } from "../catalog/chaseCards.js";
import { buildPromoCatalogFallback } from "../catalog/promoFallback.js";
import { TcgDexCatalogSource } from "../catalog/tcgDex.js";
import type { CatalogCard, CatalogSource } from "../catalog/types.js";
import { catalogIdentityKey, mergeCatalogCards } from "../catalog/catalogIdentity.js";
import { getPrisma } from "../db/prisma.js";
import type { CardRef } from "../domain/types.js";
import { CompService } from "./compService.js";
import { PrismaLastKnownCompCache } from "./prismaCompResultRepo.js";
import { OwnedSalesSource, type OwnedSalesDb } from "./sources/ownedSales.js";
import { PokeTraceSource } from "./sources/pokeTrace.js";
import { PokemonPriceTrackerSource } from "./sources/pokemonPriceTracker.js";
import { PokemonTcgMarketSource } from "./sources/pokemonTcgMarket.js";
import { EbayMarketplaceInsightsSource, isEbayMarketplaceInsightsEnabled } from "./sources/ebayMarketplaceInsights.js";
import { CheckedCompsSource, type CheckedCompDb } from "./sources/checkedComps.js";
import { addRequestedVariantHint } from "./variants.js";
import { createAbortScope } from "../http/abortScope.js";
import { collectorNumbersEquivalent } from "../cards/identity.js";

export async function resolveCatalogCard(
  card: CardRef,
  catalogSource: PokemonTcgApiCatalogSource = new PokemonTcgApiCatalogSource(),
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CatalogCard | null> {
  const abort = createAbortScope(options.signal, options.timeoutMs ?? 0);
  return withOptionalTimeout(
    resolveCatalogCardUnbounded(card, catalogSource, abort.signal),
    options.timeoutMs,
    findTimeoutCatalogFallback(card),
  ).finally(abort.cleanup);
}

async function resolveCatalogCardUnbounded(
  card: CardRef,
  catalogSource: PokemonTcgApiCatalogSource,
  signal?: AbortSignal,
): Promise<CatalogCard | null> {
  const pokemonTcgSupportsRequest = !(card.language === "JP" && catalogSource.name === "pokemon-tcg-api");
  if (card.tcgApiId && pokemonTcgSupportsRequest) {
    const directById = await catalogSource.resolve(card, { signal }).catch(() => null);
    if (directById) return directById;
  }

  const cached = catalogSource.name === "pokemon-tcg-api"
    ? await findCachedCatalogMatch(card).catch(() => null)
    : null;
  if (cached) return refreshCachedCatalogPriceSignals(cached, card, catalogSource, signal);

  const direct = pokemonTcgSupportsRequest
    ? await catalogSource.resolve(card, { signal }).catch(() => null)
    : null;
  if (direct && catalogCardMatchesLookupContext(direct, card)) return direct;

  const searched = pokemonTcgSupportsRequest
    ? await catalogSource.search(card, 5, { signal }).catch(() => [])
    : [];
  const best = searched.find((candidate) => catalogCardMatchesLookupContext(candidate, card)) ?? null;
  const tcgDexFallback = best || catalogSource.name !== "pokemon-tcg-api"
    ? null
    : await new TcgDexCatalogSource().resolve(card, { signal }).catch(() => null);
  const fallback = best ?? tcgDexFallback ?? findChaseCatalogMatch(card) ?? buildPromoCatalogFallback(card);
  if (!fallback?.tcgApiId) return fallback;

  return catalogSource.resolve({ ...card, tcgApiId: fallback.tcgApiId }, { signal })
    .then((resolved) => (resolved && catalogCardMatchesLookupContext(resolved, card) ? resolved : fallback))
    .catch(() => fallback);
}

/**
 * `findCachedCatalogMatch` only ever returns stable identity fields (name,
 * set, number, image, ids) -- never live price signals, since the local
 * Card table is an identity cache, not a price cache. Without this
 * refresh, any card that already exists in the DB (e.g. it's already in
 * inventory) would short-circuit straight past the live catalog fetch,
 * silently starving the pokemon-tcg-market RAW fallback source of the
 * current TCGPlayer/Cardmarket prices it would otherwise have found --
 * even though the comp lookup overall looked like it "worked" (a catalog
 * card was resolved), the price-bearing source behind it never ran.
 * Re-resolves by id to pick up current prices and falls back to the
 * cached identity untouched if the live refresh fails or is empty, so a
 * slow/rate-limited API never turns a cache hit into a worse outcome.
 */
export async function refreshCachedCatalogPriceSignals(
  cached: CatalogCard,
  card: CardRef,
  catalogSource: CatalogSource,
  signal?: AbortSignal,
): Promise<CatalogCard> {
  if ((cached.priceSignals?.length ?? 0) > 0 || !cached.tcgApiId) return cached;
  const refreshed = await catalogSource.resolve({ ...card, tcgApiId: cached.tcgApiId }, { signal }).catch(() => null);
  return refreshed ?? cached;
}

export async function findCatalogAlternatives(
  card: CardRef,
  catalogSource: PokemonTcgApiCatalogSource = new PokemonTcgApiCatalogSource(),
  limit = 4,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CatalogCard[]> {
  const safeLimit = Math.max(1, Math.min(8, Math.round(limit)));
  const normalized = normalizeCatalogCardSearchInput(card.name, card.setName);
  const query = [normalized.name || card.name, normalized.number ?? card.number].filter(Boolean).join(" ");
  if (!query.trim()) return [];

  const chaseCards = searchChaseCards(query, card.setName ?? normalized.setName, Math.max(safeLimit * 2, 8));
  const cachedCardsPromise = catalogSource.name === "pokemon-tcg-api"
    ? findCachedCatalogCandidates(card, Math.max(safeLimit * 4, 24)).catch(() => [])
    : Promise.resolve<CatalogCard[]>([]);
  const abort = createAbortScope(options.signal, options.timeoutMs ?? 0);
  const liveSearch = catalogSource.search(card, Math.max(safeLimit * 2, 8), { signal: abort.signal }).catch(() => []);
  const [cachedCards, liveCards] = await Promise.all([
    withOptionalTimeout(cachedCardsPromise, cachedLookupTimeoutMs(options.timeoutMs), []),
    withOptionalTimeout(liveSearch, options.timeoutMs, []),
  ]).finally(abort.cleanup);
  const ranked = rankCatalogCards(query, [...cachedCards, ...liveCards, ...chaseCards], {
    setName: card.setName ?? normalized.setName,
    limit: Math.max(safeLimit * 3, 12),
  });

  const seen = new Set<string>();
  const alternatives: CatalogCard[] = [];
  for (const candidate of ranked) {
    if (catalogCardMatchesLookupContext(candidate, card)) continue;
    const key = catalogIdentityKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    alternatives.push(candidate);
    if (alternatives.length >= safeLimit) break;
  }
  return alternatives;
}

export async function findAmbiguousCatalogCandidates(
  card: CardRef,
  catalogSource: PokemonTcgApiCatalogSource = new PokemonTcgApiCatalogSource(),
  limit = 8,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CatalogCard[]> {
  if (card.tcgApiId || requestHasExplicitCardNumber(card)) return [];
  const safeLimit = Math.max(2, Math.min(12, Math.round(limit)));
  const normalized = normalizeCatalogCardSearchInput(card.name, card.setName);
  const query = [normalized.name || card.name, normalized.number ?? card.number].filter(Boolean).join(" ");
  if (!query.trim()) return [];

  const chaseCards = searchChaseCards(query, card.setName ?? normalized.setName, Math.max(safeLimit * 2, 12));
  const cachedCardsPromise = catalogSource.name === "pokemon-tcg-api"
    ? findCachedCatalogCandidates(card, Math.max(safeLimit * 4, 24)).catch(() => [])
    : Promise.resolve<CatalogCard[]>([]);
  const abort = createAbortScope(options.signal, options.timeoutMs ?? 0);
  const liveSearch = catalogSource.search(card, Math.max(safeLimit * 2, 12), { signal: abort.signal }).catch(() => []);
  const [cachedCards, liveCards] = await Promise.all([
    withOptionalTimeout(cachedCardsPromise, cachedLookupTimeoutMs(options.timeoutMs), []),
    withOptionalTimeout(liveSearch, options.timeoutMs, []),
  ]).finally(abort.cleanup);
  const ranked = rankCatalogCards(query, [...cachedCards, ...liveCards, ...chaseCards], {
    setName: card.setName ?? normalized.setName,
    limit: Math.max(safeLimit * 3, 16),
  });

  const candidates: CatalogCard[] = [];
  const seen = new Set<string>();
  for (const candidate of ranked) {
    if (!catalogCardMatchesLookupContext(candidate, card)) continue;
    const key = catalogIdentityKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
    if (candidates.length >= safeLimit) break;
  }
  return candidates;
}

/**
 * True when the request already pins down an exact printing via an explicit
 * collector number — either as a separate field or embedded in the typed
 * name/search text (e.g. "Zapdos 192 151"). An explicit number fully
 * disambiguates a card, so callers should skip variant-sibling checks here.
 */
export function requestHasExplicitCardNumber(card: CardRef): boolean {
  if (card.number?.trim()) return true;
  return Boolean(parseCardSearchQuery(card.name ?? "").number);
}

const VARIANT_SUFFIX_PATTERN = /[\s-](?:VMAX|VSTAR|BREAK|GX|EX|ex|V)$/i;

function variantBaseName(name: string): string {
  return name.trim().replace(VARIANT_SUFFIX_PATTERN, "").trim().toLowerCase();
}

/**
 * Finds sibling printings of the same Pokemon in the same set that a bare
 * query (no collector number) could plausibly have meant instead of the
 * card that was actually chosen — e.g. "Umbreon Evolving Skies" resolving to
 * Umbreon V (#94) while Umbreon VMAX (#95) and the alt-art "Moonbreon" VMAX
 * (#215) also exist in that set. This lets the app surface "Possible
 * matches" even when a price WAS found for the chosen card, not only when
 * the catalog/comp lookup comes back empty.
 */
export function findVariantSiblings(resolved: CatalogCard, candidates: CatalogCard[]): CatalogCard[] {
  const resolvedBase = variantBaseName(resolved.name);
  if (!resolvedBase) return [];
  const resolvedSet = resolved.setName.trim().toLowerCase();
  const seen = new Set<string>([catalogIdentityKey(resolved)]);
  const siblings: CatalogCard[] = [];
  for (const candidate of candidates) {
    if (candidate.setName.trim().toLowerCase() !== resolvedSet) continue;
    if (candidate.number && resolved.number && candidate.number === resolved.number) continue;
    if (variantBaseName(candidate.name) !== resolvedBase) continue;
    const key = catalogIdentityKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    siblings.push(candidate);
  }
  return siblings;
}

export function resolveBareSetAmbiguity(
  card: CardRef,
  resolvedCatalog: CatalogCard | null,
  candidates: CatalogCard[],
): { ambiguous: boolean; alternatives: CatalogCard[] } {
  if (requestHasExplicitCardNumber(card) || card.tcgApiId) return { ambiguous: false, alternatives: [] };
  const matchingCandidates = dedupeCatalogCards(candidates.filter((candidate) => catalogCardMatchesLookupContext(candidate, card)));
  if (matchingCandidates.length <= 1) return { ambiguous: false, alternatives: [] };
  const resolvedKey = resolvedCatalog ? catalogIdentityKey(resolvedCatalog) : null;
  return {
    ambiguous: true,
    alternatives: resolvedKey
      ? matchingCandidates.filter((candidate) => catalogIdentityKey(candidate) !== resolvedKey)
      : matchingCandidates,
  };
}

function withOptionalTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  fallback: T,
  onTimeout?: () => void,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) return promise;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      resolve(fallback);
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export function catalogToCardRef(catalog: CatalogCard, fallback: CardRef): CardRef {
  return {
    ...fallback,
    name: addRequestedVariantHint(catalog.name, fallback.name),
    setName: catalog.setName,
    number: preferPrintedCollectorNumber(catalog.number, fallback.number),
    tcgApiId: catalog.tcgApiId,
    tcgDexId: catalog.tcgDexId,
    cardmarketId: catalog.cardmarketId,
    edition: catalog.edition ?? fallback.edition,
    finish: catalog.finish ?? fallback.finish,
    game: catalog.game,
    language: catalog.language,
  };
}

export function preferPrintedCollectorNumber(
  catalogNumber: string | null | undefined,
  requestedNumber: string | null | undefined,
): string | undefined {
  const catalog = catalogNumber?.trim() || undefined;
  const requested = requestedNumber?.trim() || undefined;
  if (!catalog) return requested;
  if (!requested) return catalog;
  if (collectorNumbersEquivalent(catalog, requested) && requested.includes("/") && !catalog.includes("/")) {
    return requested;
  }
  return catalog;
}

export function createAppCompService(
  catalogSource: CatalogSource = new PokemonTcgApiCatalogSource(),
  catalog: CatalogCard | null = null,
): CompService {
  return new CompService(
    [
      new PokemonPriceTrackerSource(),
      ...(isEbayMarketplaceInsightsEnabled() ? [new EbayMarketplaceInsightsSource()] : []),
      new PokemonTcgMarketSource(catalog ? fixedCatalogSource(catalogSource.live, catalog) : catalogSource),
      new PokeTraceSource(),
      ...(process.env.DATABASE_URL ? [new CheckedCompsSource(getPrisma() as unknown as CheckedCompDb)] : []),
      ...(process.env.DATABASE_URL ? [new OwnedSalesSource(getPrisma() as unknown as OwnedSalesDb)] : []),
    ],
    undefined,
    process.env.DATABASE_URL ? new PrismaLastKnownCompCache() : null,
  );
}

export function fixedCatalogSource(live: boolean, catalog: CatalogCard): CatalogSource {
  return {
    name: "request-catalog",
    live,
    async resolve() {
      return catalog;
    },
  };
}

function dedupeCatalogCards(cards: CatalogCard[]): CatalogCard[] {
  return mergeCatalogCards(cards);
}

async function findCachedCatalogMatch(card: CardRef): Promise<CatalogCard | null> {
  const ranked = await findCachedCatalogCandidates(card, 8);
  return ranked.find((candidate) => catalogCardMatchesLookupContext(candidate, card)) ?? null;
}

async function findCachedCatalogCandidates(card: CardRef, limit: number): Promise<CatalogCard[]> {
  if (!process.env.DATABASE_URL) return [];
  const normalized = normalizeCatalogCardSearchInput(card.name, card.setName);
  const query = [normalized.name || card.name, normalized.number ?? card.number].filter(Boolean).join(" ");
  if (!query.trim()) return [];

  const rows = await getPrisma().card.findMany({
    where: {
      game: "POKEMON",
      language: card.language ?? "EN",
      ...(card.edition ? { edition: card.edition } : {}),
      ...(card.finish ? { finish: card.finish } : {}),
      OR: [
        { name: { contains: normalized.name || card.name, mode: "insensitive" } },
        ...(normalized.number ?? card.number
          ? [{ number: { contains: normalized.number ?? card.number, mode: "insensitive" as const } }]
          : []),
        ...(normalized.setName ?? card.setName
          ? [{ setName: { contains: normalized.setName ?? card.setName, mode: "insensitive" as const } }]
          : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: Math.max(120, limit * 8),
  });

  return rankCatalogCards(
    query,
    rows.map((row) => ({
      game: row.game,
      language: row.language,
      name: row.name,
      setName: row.setName,
      setCode: row.setCode ?? undefined,
      number: row.number ?? undefined,
      rarity: row.rarity ?? undefined,
      imageUrl: row.imageUrl ?? undefined,
      displayImageUrl: row.displayImageUrl ?? undefined,
      tcgApiId: row.tcgApiId ?? undefined,
      tcgDexId: row.tcgDexId ?? undefined,
      cardmarketId: row.cardmarketId ?? undefined,
      edition: row.edition as CardRef["edition"],
      finish: row.finish as CardRef["finish"],
      provenance: {
        origin: "cache",
        providers: [row.tcgApiId ? "pokemon-tcg-api" : null, row.tcgDexId ? "tcgdex" : null].filter((value): value is string => Boolean(value)),
        cachedAt: row.updatedAt.toISOString(),
      },
    })),
    { setName: normalized.setName ?? card.setName, limit },
  );
}

function findChaseCatalogMatch(card: CardRef): CatalogCard | null {
  const normalized = normalizeCatalogCardSearchInput(card.name, card.setName);
  const query = [normalized.name || card.name, normalized.number ?? card.number].filter(Boolean).join(" ");
  if (!query.trim()) return null;

  return (
    searchChaseCards(query, card.setName ?? normalized.setName, 5)
      .find((candidate) => catalogCardMatchesLookupContext(candidate, card)) ?? buildPromoCatalogFallback(card)
  );
}

function findTimeoutCatalogFallback(card: CardRef): CatalogCard | null {
  if (!requestHasExplicitCardNumber(card) && !card.tcgApiId) return null;
  return findChaseCatalogMatch(card);
}

function cachedLookupTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) return 2500;
  return Math.max(1500, Math.min(timeoutMs, 2500));
}
