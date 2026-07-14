// POST /api/inventory/acquire — the flagship dealer action.
// Given a card I've just bought, look up its live comp, compute a suggested list price,
// persist it as stock, and create a listing at that price. One call = the whole
// "value → buy → stock → price" loop.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  catalogToCardRef,
  createAppCompService,
  fixedCatalogSource,
  resolveCatalogCard,
} from "@/lib/comps/appCompLookup";
import { PrismaInventoryRepo } from "@/lib/inventory/prismaInventoryRepo";
import { PrismaCompResultRepo } from "@/lib/comps/prismaCompResultRepo";
import { resolveCompCardImage } from "@/lib/comps/cardArt";
import { persistResolvedDisplayImage, withResolvedDisplayImage } from "@/lib/comps/cardArtPersistence";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import { acquireToInventory } from "@/lib/inventory/inventoryService";
import { getPrisma } from "@/lib/db/prisma";
import { buildCheckedComp } from "@/lib/dealer/checkedComp";
import { GRADE_VALUES, type CardRef } from "@/lib/domain/types";
import { PrismaCheckedCompRepo, type CheckedCompDb, type CheckedCompPlatform } from "@/lib/comps/sources/checkedComps";
import { readClientMutationId } from "@/lib/offline/clientMutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gradeSchema = z.enum(GRADE_VALUES);

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
  condition: z.string().trim().min(1).optional(),
  graderCert: z.string().trim().min(1).optional(),
  strategy: z.enum(["quick", "market", "patient"]).default("market"),
  minMargin: z.coerce.number().min(0).max(5).optional(),
  channel: z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]).default("EBAY"),
  listPricePence: z.coerce.number().int().nonnegative().optional(),
  listingState: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
  createListing: z.boolean().default(true),
  checkedComp: z
    .object({
      pricePence: z.coerce.number().int().positive(),
      sampleSize: z.coerce.number().int().positive().default(1),
      windowDays: z.coerce.number().int().positive().max(365).default(30),
      source: z.enum(["EBAY_SOLD", "CARDMARKET", "TCGPLAYER", "OTHER"]).default("EBAY_SOLD"),
      note: z.string().trim().min(1).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const mutation = readClientMutationId(request);
  if (!mutation.ok) return NextResponse.json({ error: mutation.error }, { status: 400 });
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
  if (
    d.createListing &&
    d.channel === "EBAY" &&
    d.listPricePence !== undefined &&
    d.listPricePence < 99
  ) {
    return NextResponse.json(
      {
        error:
          "Your eBay list price must be at least £0.99. Enter what you paid separately; the list price is what buyers will see.",
      },
      { status: 400 },
    );
  }
  const card: CardRef = { ...d.card, game: "POKEMON", language: "EN" };

  try {
    if (mutation.value) {
      const replay = await replayAcquire(mutation.value, d.strategy);
      if (replay) return replay;
    }
    const catalogSource = new PokemonTcgApiCatalogSource();
    const catalog = await resolveCatalogCard(card, catalogSource);
    const compCard = catalog ? catalogToCardRef(catalog, card) : card;

    // 1. live comp for this card+grade
    const comps = await createAppCompService(catalogSource, catalog).lookup(compCard, { grade: d.grade });
    const checkedComp = d.checkedComp
      ? buildCheckedComp({
          card: compCard,
          grade: d.grade,
          pricePence: d.checkedComp.pricePence,
          sampleSize: d.checkedComp.sampleSize,
          windowDays: d.checkedComp.windowDays,
          source: d.checkedComp.source,
          note: d.checkedComp.note,
        })
      : null;
    const pricingComp = checkedComp ?? comps.headline;
    const responseComps = checkedComp
      ? { ...comps, headline: checkedComp, all: [checkedComp, ...comps.all], sourcesDisagree: false }
      : comps;
    const cardImage = resolveCompCardImage({ catalog, headline: responseComps.headline, all: responseComps.all });
    const responseCatalog = withResolvedDisplayImage(catalog, cardImage);

    // 2. persist comp history (best-effort)
    if (process.env.DATABASE_URL) {
      if (cardImage.imageUrl && !cardImage.listingSafe) {
        await persistResolvedDisplayImage({
          card: compCard,
          catalog: responseCatalog,
          cardImage,
          catalogSource: responseCatalog ? fixedCatalogSource(catalogSource.live, responseCatalog) : null,
        }).catch((err) =>
          console.warn("[acquire] card display image persistence skipped:", err instanceof Error ? err.message : "unknown"),
        );
      }
      const compRepo = new PrismaCompResultRepo();
      if (comps.headline) {
        await compRepo.create(comps.headline).catch((err) =>
          console.warn("[acquire] comp persistence skipped:", err instanceof Error ? err.message : "unknown"),
        );
      }
      if (checkedComp) {
        await compRepo.create(checkedComp).catch((err) =>
          console.warn("[acquire] checked comp persistence skipped:", err instanceof Error ? err.message : "unknown"),
        );
      }
      if (d.checkedComp) {
        await new PrismaCheckedCompRepo(
          getPrisma() as unknown as CheckedCompDb,
          catalog ? fixedCatalogSource(catalogSource.live, catalog) : catalogSource,
        ).create({
          card: compCard,
          grade: d.grade,
          pricePence: d.checkedComp.pricePence,
          platform: checkedCompPlatformFromLegacySource(d.checkedComp.source),
          note: d.checkedComp.note,
        }).catch((err) =>
          console.warn("[acquire] checked comp row persistence skipped:", err instanceof Error ? err.message : "unknown"),
        );
      }
    }

    // 3. stock it + compute the suggested list price (valuing and pricing are one pipeline)
    const inventoryRepo = new PrismaInventoryRepo(
      undefined,
      catalog ? fixedCatalogSource(catalogSource.live, catalog) : undefined,
    );
    const { item, suggestion } = await acquireToInventory(inventoryRepo, {
      card: compCard,
      grade: d.grade,
      costBasisPence: d.costBasisPence,
      quantity: d.quantity,
      acquiredFrom: d.acquiredFrom,
      location: d.location,
      condition: d.condition,
      graderCert: d.graderCert,
      clientMutationId: mutation.value ?? undefined,
      comp: pricingComp,
      strategy: d.strategy,
      minMargin: d.minMargin,
    });

    // 4. create a listing at the suggested/chosen price (best-effort; never fails the acquire)
    let listing: {
      id: string;
      channel: string;
      state: string;
      suggestedPrice: number | null;
      listPrice: number | null;
    } | null = null;
    if (d.createListing) {
      const effectiveListingState = d.channel === "EBAY" ? "DRAFT" : d.listingState;
      const title = [compCard.name, compCard.number, d.grade === "RAW" ? "" : d.grade.replace(/_/g, " ")]
        .filter(Boolean)
        .join(" ");
      listing = await getPrisma()
        .$transaction(async (tx) => {
          const created = await tx.listing.create({
            data: {
              itemId: item.id,
              channel: d.channel,
              state: effectiveListingState,
              title,
              suggestedPrice: suggestion.pricePence,
              listPrice: d.listPricePence ?? null,
              listedAt: effectiveListingState === "ACTIVE" ? new Date() : null,
            },
            select: { id: true, channel: true, state: true, suggestedPrice: true, listPrice: true },
          });

          if (effectiveListingState === "ACTIVE") {
            await tx.inventoryItem.update({
              where: { id: item.id },
              data: { status: "LISTED" },
            });
          }

          return created;
        })
        .catch((err) => {
          console.warn("[acquire] draft listing skipped:", err instanceof Error ? err.message : "unknown");
          return null;
        });
    }

    return NextResponse.json({
      item,
      suggestion,
      comp: pricingComp,
      comps: { ...responseComps, catalog: responseCatalog, cardImage },
      catalog: responseCatalog,
      cardImage,
      listing,
    }, { status: 201 });
  } catch (err) {
    if (mutation.value) {
      const replay = await replayAcquire(mutation.value, d.strategy).catch(() => null);
      if (replay) return replay;
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "acquire failed" },
      { status: 500 },
    );
  }
}

async function replayAcquire(clientMutationId: string, strategy: "quick" | "market" | "patient") {
  const item = await getPrisma().inventoryItem.findUnique({
    where: { clientMutationId },
    include: {
      card: true,
      listings: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!item) return null;
  const listing = item.listings[0] ?? null;
  return NextResponse.json({
    item: {
      id: item.id,
      card: {
        id: item.card.id,
        name: item.card.name,
        setName: item.card.setName,
        number: item.card.number ?? undefined,
        tcgApiId: item.card.tcgApiId ?? undefined,
        game: item.card.game,
        language: item.card.language,
      },
      grade: item.grade,
      quantity: item.quantity,
      costBasisPence: item.costBasis,
      acquiredFrom: item.acquiredFrom ?? undefined,
      location: item.location ?? undefined,
      condition: item.condition ?? undefined,
      graderCert: item.graderCert ?? undefined,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      clientMutationId,
    },
    suggestion: {
      pricePence: listing?.suggestedPrice ?? listing?.listPrice ?? 0,
      strategy,
      confidence: "none",
      flooredToMargin: false,
      rationale: "Idempotent replay of an acquisition already committed.",
    },
    comp: null,
    comps: null,
    catalog: null,
    cardImage: null,
    listing,
    idempotent: true,
  }, { status: 200 });
}

function checkedCompPlatformFromLegacySource(source: string | undefined): CheckedCompPlatform {
  if (source === "CARDMARKET") return "cardmarket";
  if (source === "OTHER" || source === "TCGPLAYER") return "other";
  return "ebay-uk";
}
