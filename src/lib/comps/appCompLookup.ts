import { PokemonTcgApiCatalogSource } from "../catalog/pokemonTcgApi.js";
import type { CatalogCard, CatalogSource } from "../catalog/types.js";
import { getPrisma } from "../db/prisma.js";
import type { CardRef } from "../domain/types.js";
import { CompService } from "./compService.js";
import { OwnedSalesSource, type OwnedSalesDb } from "./sources/ownedSales.js";
import { PokeTraceSource } from "./sources/pokeTrace.js";
import { PokemonPriceTrackerSource } from "./sources/pokemonPriceTracker.js";
import { PokemonTcgMarketSource } from "./sources/pokemonTcgMarket.js";

export async function resolveCatalogCard(
  card: CardRef,
  catalogSource: PokemonTcgApiCatalogSource = new PokemonTcgApiCatalogSource(),
): Promise<CatalogCard | null> {
  const direct = await catalogSource.resolve(card).catch(() => null);
  if (direct) return direct;

  const searched = await catalogSource.search(card, 5).catch(() => []);
  const best = searched[0] ?? null;
  if (!best?.tcgApiId) return best;

  return catalogSource.resolve({ ...card, tcgApiId: best.tcgApiId }).catch(() => best);
}

export function catalogToCardRef(catalog: CatalogCard, fallback: CardRef): CardRef {
  return {
    ...fallback,
    name: catalog.name,
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
