// Vertical-slice API: GET /api/comps?name=Charizard ex&number=199/165&grade=RAW
// Returns the reconciled comp for a card+grade. Runs in fixture mode until keys are set.

import { NextResponse } from "next/server";
import { CompService } from "@/lib/comps/compService";
import { PrismaCompResultRepo } from "@/lib/comps/prismaCompResultRepo";
import { OwnedSalesSource, type OwnedSalesDb } from "@/lib/comps/sources/ownedSales";
import { PokemonPriceTrackerSource } from "@/lib/comps/sources/pokemonPriceTracker";
import { PokemonTcgMarketSource } from "@/lib/comps/sources/pokemonTcgMarket";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import type { CatalogCard, CatalogSource } from "@/lib/catalog/types";
import { getPrisma } from "@/lib/db/prisma";
import type { CardRef, Grade } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const card: CardRef = {
    name,
    setName: searchParams.get("set") ?? undefined,
    number: searchParams.get("number") ?? undefined,
    game: "POKEMON",
    language: "EN",
  };
  const grade = (searchParams.get("grade") as Grade | null) ?? "RAW";

  try {
    const catalogSource = new PokemonTcgApiCatalogSource();
    const catalog = await catalogSource.resolve(card).catch(() => null);
    const compCard = catalog ? catalogToCardRef(catalog, card) : card;
    const compService = new CompService([
      new PokemonPriceTrackerSource(),
      new PokemonTcgMarketSource(catalog ? fixedCatalogSource(catalogSource.live, catalog) : catalogSource),
      ...(process.env.DATABASE_URL ? [new OwnedSalesSource(getPrisma() as unknown as OwnedSalesDb)] : []),
    ]);
    const result = await compService.lookup(compCard, { grade });
    if (process.env.DATABASE_URL) {
      await new PrismaCompResultRepo().create(result.headline).catch((err) => {
        console.warn(
          "[comps] comp persistence skipped:",
          err instanceof Error ? err.message : "unknown error",
        );
      });
    }
    return NextResponse.json({ ...result, catalog });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed" },
      { status: 502 },
    );
  }
}

function catalogToCardRef(catalog: CatalogCard, fallback: CardRef): CardRef {
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

function fixedCatalogSource(live: boolean, catalog: CatalogCard): CatalogSource {
  return {
    name: "request-catalog",
    live,
    async resolve() {
      return catalog;
    },
  };
}
