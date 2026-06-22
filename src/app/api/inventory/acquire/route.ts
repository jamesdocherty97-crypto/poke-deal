// POST /api/inventory/acquire — the flagship dealer action.
// Given a card I've just bought, look up its live comp, compute a suggested list price,
// persist it as stock, and create a DRAFT listing at that price. One call = the whole
// "value → buy → stock → price" loop.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  catalogToCardRef,
  createAppCompService,
  resolveCatalogCard,
} from "@/lib/comps/appCompLookup";
import { PrismaInventoryRepo } from "@/lib/inventory/prismaInventoryRepo";
import { PrismaCompResultRepo } from "@/lib/comps/prismaCompResultRepo";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import { acquireToInventory } from "@/lib/inventory/inventoryService";
import { getPrisma } from "@/lib/db/prisma";
import type { CardRef } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gradeSchema = z.enum([
  "RAW",
  "PSA_1", "PSA_2", "PSA_3", "PSA_4", "PSA_5",
  "PSA_6", "PSA_7", "PSA_8", "PSA_9", "PSA_10",
  "BGS_9", "BGS_9_5", "BGS_10",
  "CGC_9", "CGC_9_5", "CGC_10",
]);

const acquireSchema = z.object({
  card: z.object({
    name: z.string().min(1),
    setName: z.string().min(1).optional(),
    number: z.string().min(1).optional(),
    tcgApiId: z.string().min(1).optional(),
  }),
  grade: gradeSchema.default("RAW"),
  costBasisPence: z.coerce.number().int().nonnegative(),
  quantity: z.coerce.number().int().positive().default(1),
  acquiredFrom: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  strategy: z.enum(["quick", "market", "patient"]).default("market"),
  minMargin: z.coerce.number().min(0).max(5).optional(),
  channel: z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]).default("EBAY"),
  createListing: z.boolean().default(true),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = acquireSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid acquire request",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const card: CardRef = { ...d.card, game: "POKEMON", language: "EN" };

  try {
    const catalogSource = new PokemonTcgApiCatalogSource();
    const catalog = await resolveCatalogCard(card, catalogSource);
    const compCard = catalog ? catalogToCardRef(catalog, card) : card;

    // 1. live comp for this card+grade
    const comps = await createAppCompService(catalogSource, catalog).lookup(compCard, { grade: d.grade });

    // 2. persist comp history (best-effort)
    if (process.env.DATABASE_URL) {
      await new PrismaCompResultRepo().create(comps.headline).catch((err) =>
        console.warn("[acquire] comp persistence skipped:", err instanceof Error ? err.message : "unknown"),
      );
    }

    // 3. stock it + compute the suggested list price (valuing and pricing are one pipeline)
    const { item, suggestion } = await acquireToInventory(new PrismaInventoryRepo(), {
      card: compCard,
      grade: d.grade,
      costBasisPence: d.costBasisPence,
      quantity: d.quantity,
      acquiredFrom: d.acquiredFrom,
      location: d.location,
      comp: comps.headline,
      strategy: d.strategy,
      minMargin: d.minMargin,
    });

    // 4. create a DRAFT listing at the suggested price (best-effort; never fails the acquire)
    let listing: { id: string; channel: string; suggestedPrice: number | null } | null = null;
    if (d.createListing) {
      const title = [compCard.name, compCard.number, d.grade === "RAW" ? "" : d.grade.replace(/_/g, " ")]
        .filter(Boolean)
        .join(" ");
      listing = await getPrisma()
        .listing.create({
          data: {
            itemId: item.id,
            channel: d.channel,
            state: "DRAFT",
            title,
            suggestedPrice: suggestion.pricePence,
          },
          select: { id: true, channel: true, suggestedPrice: true },
        })
        .catch((err) => {
          console.warn("[acquire] draft listing skipped:", err instanceof Error ? err.message : "unknown");
          return null;
        });
    }

    return NextResponse.json({ item, suggestion, comp: comps.headline, comps, catalog, listing }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "acquire failed" },
      { status: 500 },
    );
  }
}
