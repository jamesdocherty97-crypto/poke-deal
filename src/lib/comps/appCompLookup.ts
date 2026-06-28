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
import { getPrisma } from "../db/prisma.js";
import type { CardRef } from "../domain/types.js";
import { CompService } from "./compService.js";
import { OwnedSalesSource, type OwnedSalesDb } from "./sources/ownedSales.js";
import { PokeTraceSource } from "./sources/pokeTrace.js";
import { PokemonPriceTrackerSource } from "./sources/pokemonPriceTracker.js";
import { PokemonTcgMarketSource } from "./sources/pokemonTcgMarket.js";
import { EbayMarketplaceInsightsSource } from "./sources/ebayMarketplaceInsights.js";
import { addRequestedVariantHint } from "./variants.js";

export async function resolveCatalogCard(
  card: CardRef,
  catalogSource: PokemonTcgApiCatalogSource = new PokemonTcgApiCatalogSource(),
  options: { timeoutMs?: number } = {},
): Promise<CatalogCard | null> {
  return withOptionalTimeout(resolveCatalogCardUnbounded(card, catalogSource), options.timeoutMs, findChaseCatalogMatch(card));
}

async function resolveCatalogCardUnbounded(
  card: CardRef,
  catalogSource: PokemonTcgApiCatalogSource,
): Promise<CatalogCard | null> {
  if (card.tcgApiId) {
    const directById = await catalogSource.resolve(card).catch(() => null);
    if (directById) return directById;
  }

  const cached = catalogSource.name === "pokemon-tcg-api"
    ? await findCachedCatalogMatch(card).catch(() => null)
    : null;
  if (cached) return refreshCachedCatalogPriceSignals(cached, card, catalogSource);

  const direct = await catalogSource.resolve(card).catch(() => null);
  if (direct && catalogCardMatchesLookupContext(direct, card)) return direct;

  const searched = await catalogSource.search(card, 5).catch(() => []);
  const best = searched.find((candidate) => catalogCardMatchesLookupContext(candidate, card)) ?? null;
  const tcgDexFallback = best || catalogSource.name !== "pokemon-tcg-api"
    ? null
    : await new TcgDexCatalogSource().resolve(card).catch(() => null);
  const fallback = best ?? tcgDexFallback ?? findChaseCatalogMatch(card) ?? buildPromoCatalogFallback(card);
  if (!fallback?.tcgApiId) return fallback;

  return catalogSource.resolve({ ...card, tcgApiId: fallback.tcgApiId })
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
): Promise<CatalogCard> {
  if ((cached.priceSignals?.length ?? 0) > 0 || !cached.tcgApiId) return cached;
  const refreshed = await catalogSource.resolve({ ...card, tcgApiId: cached.tcgApiId }).catch(() => null);
  return refreshed ?? cached;
}

export async function findCatalogAlternatives(
  card: CardRef,
  catalogSource: PokemonTcgApiCatalogSource = new PokemonTcgApiCatalogSource(),
  limit = 4,
  options: { timeoutMs?: number } = {},
): Promise<CatalogCard[]> {
  const safeLimit = Math.max(1, Math.min(8, Math.round(limit)));
  const normalized = normalizeCatalogCardSearchInput(card.name, card.setName);
  const query = [normalized.name || card.name, normalized.number ?? card.number].filter(Boolean).join(" ");
  if (!query.trim()) return [];

  const chaseCards = searchChaseCards(query, card.setName ?? normalized.setName, Math.max(safeLimit * 2, 8));
  const liveSearch = catalogSource.search(card, Math.max(safeLimit * 2, 8)).catch(() => []);
  const liveCards = await withOptionalTimeout(liveSearch, options.timeoutMs, []);
  const ranked = rankCatalogCards(query, [...liveCards, ...chaseCards], {
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
  options: { timeoutMs?: number } = {},
): Promise<CatalogCard[]> {
  if (card.tcgApiId || requestHasExplicitCardNumber(card)) return [];
  const safeLimit = Math.max(2, Math.min(12, Math.round(limit)));
  const normalized = normalizeCatalogCardSearchInput(card.name, card.setName);
  const query = [normalized.name || card.name, normalized.number ?? card.number].filter(Boolean).join(" ");
  if (!query.trim()) return [];

  const chaseCards = searchChaseCards(query, card.setName ?? normalized.setName, Math.max(safeLimit * 2, 12));
  const liveSearch = catalogSource.search(card, Math.max(safeLimit * 2, 12)).catch(() => []);
  const liveCards = await withOptionalTimeout(liveSearch, options.timeoutMs, []);
  const ranked = rankCatalogCards(query, [...liveCards, ...chaseCards], {
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

function withOptionalTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, fallback: T): Promise<T> {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) return promise;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
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
    number: catalog.number ?? fallback.number,
    tcgApiId: catalog.tcgApiId,
    tcgDexId: catalog.tcgDexId,
    game: catalog.game,
    language: catalog.language,
  };
}

export function createAppCompService(
  catalogSource: CatalogSource,
  catalog: CatalogCard | null,
): CompService {
  return new CompService([
    new PokemonPriceTrackerSource(),
    new EbayMarketplaceInsightsSource(),
    new PokemonTcgMarketSource(catalog ? fixedCatalogSource(catalogSource.live, catalog) : catalogSource),
    new PokeTraceSource(),
    ...(process.env.DATABASE_URL ? [new OwnedSalesSource(getPrisma() as unknown as OwnedSalesDb)] : []),
  ]);
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

function catalogIdentityKey(card: CatalogCard): string {
  return (
    card.tcgApiId ??
    card.tcgDexId ??
    [
      card.name.trim().toLowerCase(),
      card.setName.trim().toLowerCase(),
      (card.number ?? "").trim().toLowerCase(),
    ].join("|")
  );
}

async function findCachedCatalogMatch(card: CardRef): Promise<CatalogCard | null> {
  if (!process.env.DATABASE_URL) return null;
  const normalized = normalizeCatalogCardSearchInput(card.name, card.setName);
  const query = [normalized.name || card.name, normalized.number ?? card.number].filter(Boolean).join(" ");
  if (!query.trim()) return null;

  const rows = await getPrisma().card.findMany({
    where: {
      game: "POKEMON",
      language: "EN",
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
    take: 120,
  });

  const ranked = rankCatalogCards(
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
      tcgApiId: row.tcgApiId ?? undefined,
      tcgDexId: row.tcgDexId ?? undefined,
    })),
    { setName: normalized.setName ?? card.setName, limit: 8 },
  );

  return ranked.find((candidate) => catalogCardMatchesLookupContext(candidate, card)) ?? null;
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
