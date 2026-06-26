import { PokemonTcgApiCatalogSource } from "../catalog/pokemonTcgApi.js";
import {
  catalogCardMatchesLookupContext,
  normalizeCatalogCardSearchInput,
  rankCatalogCards,
} from "../catalog/cardSearch.js";
import { searchChaseCards } from "../catalog/chaseCards.js";
import type { CatalogCard, CatalogSource } from "../catalog/types.js";
import { getPrisma } from "../db/prisma.js";
import type { CardRef } from "../domain/types.js";
import { CompService } from "./compService.js";
import { OwnedSalesSource, type OwnedSalesDb } from "./sources/ownedSales.js";
import { PokeTraceSource } from "./sources/pokeTrace.js";
import { PokemonPriceTrackerSource } from "./sources/pokemonPriceTracker.js";
import { PokemonTcgMarketSource } from "./sources/pokemonTcgMarket.js";
import { requestsFirstEdition } from "./variants.js";

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
  const direct = await catalogSource.resolve(card).catch(() => null);
  if (direct && catalogCardMatchesLookupContext(direct, card)) return direct;

  const searched = await catalogSource.search(card, 5).catch(() => []);
  const best = searched.find((candidate) => catalogCardMatchesLookupContext(candidate, card)) ?? null;
  const fallback = best ?? findChaseCatalogMatch(card);
  if (!fallback?.tcgApiId) return fallback;

  return catalogSource.resolve({ ...card, tcgApiId: fallback.tcgApiId })
    .then((resolved) => (resolved && catalogCardMatchesLookupContext(resolved, card) ? resolved : fallback))
    .catch(() => fallback);
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
    name: requestsFirstEdition(fallback) ? fallback.name : catalog.name,
    setName: catalog.setName,
    number: catalog.number ?? fallback.number,
    tcgApiId: catalog.tcgApiId,
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
    [
      card.name.trim().toLowerCase(),
      card.setName.trim().toLowerCase(),
      (card.number ?? "").trim().toLowerCase(),
    ].join("|")
  );
}

function findChaseCatalogMatch(card: CardRef): CatalogCard | null {
  const normalized = normalizeCatalogCardSearchInput(card.name, card.setName);
  const query = [normalized.name || card.name, normalized.number ?? card.number].filter(Boolean).join(" ");
  if (!query.trim()) return null;

  return (
    searchChaseCards(query, card.setName ?? normalized.setName, 5)
      .find((candidate) => catalogCardMatchesLookupContext(candidate, card)) ?? null
  );
}
