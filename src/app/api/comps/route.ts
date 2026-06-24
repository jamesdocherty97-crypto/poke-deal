// Vertical-slice API: GET /api/comps?name=Charizard ex&number=199/165&grade=RAW
// Returns the reconciled comp for a card+grade. Runs in fixture mode until keys are set.

import { NextResponse } from "next/server";
import {
  catalogToCardRef,
  createAppCompService,
  findCatalogAlternatives,
  resolveCatalogCard,
} from "@/lib/comps/appCompLookup";
import { PrismaCompResultRepo } from "@/lib/comps/prismaCompResultRepo";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
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
    const catalog = await resolveCatalogCard(card, catalogSource);
    const compCard = catalog ? catalogToCardRef(catalog, card) : card;
    const compService = createAppCompService(catalogSource, catalog);
    const result = await compService.lookup(compCard, { grade });
    const needsRecovery = !catalog || result.headline.sampleSize === 0 || result.headline.medianPence <= 0;
    const alternatives = needsRecovery ? await findCatalogAlternatives(card, catalogSource, 4) : [];
    if (process.env.DATABASE_URL) {
      await new PrismaCompResultRepo().create(result.headline).catch((err) => {
        console.warn(
          "[comps] comp persistence skipped:",
          err instanceof Error ? err.message : "unknown error",
        );
      });
    }
    return NextResponse.json({ ...result, catalog, alternatives });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed" },
      { status: 502 },
    );
  }
}
