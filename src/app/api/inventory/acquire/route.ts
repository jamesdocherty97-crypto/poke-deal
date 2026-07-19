// POST /api/inventory/acquire — the flagship dealer action.
// Given a card I've just bought, look up its live comp, compute a suggested list price,
// persist it as stock, and create a listing at that price. One call = the whole
// "value → buy → stock → price" loop.

import { NextResponse } from "next/server";
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
import { buildListingTitle } from "@/lib/dealer/listingDraft";
import type { CardRef, CompResult } from "@/lib/domain/types";
import type { ReconciledComp } from "@/lib/comps/compService";
import { PrismaCheckedCompRepo, type CheckedCompDb, type CheckedCompPlatform } from "@/lib/comps/sources/checkedComps";
import { compForAutomaticPricing, normalizeRawCondition, reviewedCompRequiresManualPricing } from "@/lib/comps/pricing";
import { readClientMutationId } from "@/lib/offline/clientMutation";
import { acquireRequestSchema } from "@/lib/inventory/apiSchemas";
import { inventoryItemUiInclude } from "@/lib/inventory/apiRecord";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const mutation = readClientMutationId(request);
  if (!mutation.ok) return NextResponse.json({ error: mutation.error }, { status: 400 });
  const body = await request.json().catch(() => null);
  const parsed = acquireRequestSchema.safeParse(body);
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
  const compCondition = d.grade === "RAW" ? normalizeRawCondition(d.condition) ?? undefined : undefined;
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
  const card: CardRef = { ...d.card, game: "POKEMON" };

  try {
    if (mutation.value) {
      const replay = await replayAcquire(mutation.value, d.strategy);
      if (replay) return replay;
    }
    const catalogSource = new PokemonTcgApiCatalogSource();
    const catalog = await resolveCatalogCard(card, catalogSource);
    const compCard = catalog ? catalogToCardRef(catalog, card) : card;

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
    const reviewedComps: ReconciledComp | null = d.reviewedComps
      ? {
          headline: reviewedCompResult(d.reviewedComps.headline, compCard, d.grade),
          all: d.reviewedComps.all.map((result) => reviewedCompResult(result, compCard, d.grade)),
          sourcesDisagree: d.reviewedComps.sourcesDisagree,
        }
      : null;

    // Reuse the receipt that was already shown and accepted in the UI. A live
    // lookup remains the fallback for direct API callers without that receipt.
    const comps: ReconciledComp = reviewedComps ?? (checkedComp
      ? { headline: checkedComp, all: [checkedComp], sourcesDisagree: false }
      : await createAppCompService(catalogSource, catalog).lookup(compCard, { grade: d.grade, condition: compCondition }));
    // A client-supplied single checked price is not traceable evidence; run it
    // through the same high-value RAW guard as reviewed receipts so a stale
    // offline replay or direct API call cannot auto-price from one bare number.
    const compNeedsManualCheck = checkedComp
      ? reviewedCompRequiresManualPricing({
          sourcesDisagree: false,
          grade: d.grade,
          source: checkedComp.source,
          medianPence: checkedComp.medianPence,
        })
      : d.reviewedComps
        ? reviewedCompRequiresManualPricing({
            explicitManualCheck: d.reviewedComps.manualCheck,
            sourcesDisagree: d.reviewedComps.sourcesDisagree,
            grade: d.grade,
            source: d.reviewedComps.headline.source,
            medianPence: d.reviewedComps.headline.medianPence,
          })
        : Boolean(comps.reconciliation?.manualCheck);
    // Keep the evidence receipt for audit/history, but never feed an explicitly
    // cautious headline into automatic listing-price generation.
    const pricingComp = compForAutomaticPricing(checkedComp ?? comps.headline, compNeedsManualCheck);
    const responseComps = checkedComp
      ? {
          ...comps,
          headline: checkedComp,
          all: reviewedComps ? [checkedComp, ...comps.all] : [checkedComp],
          sourcesDisagree: false,
        }
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
      if (comps.headline && comps.headline !== checkedComp) {
        await compRepo.create(comps.headline, { condition: compCondition }).catch((err) =>
          console.warn("[acquire] comp persistence skipped:", err instanceof Error ? err.message : "unknown"),
        );
      }
      if (checkedComp) {
        await compRepo.create(checkedComp, { condition: compCondition }).catch((err) =>
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
          condition: compCondition,
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
    const { item: acquiredItem, suggestion } = await acquireToInventory(inventoryRepo, {
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
    let createdListingId: string | null = null;
    let listingWarning: string | null = null;
    if (d.createListing) {
      const effectiveListingState = d.channel === "EBAY" ? "DRAFT" : d.listingState;
      const title = buildListingTitle(compCard, d.grade, d.condition);
      createdListingId = await getPrisma()
        .$transaction(async (tx) => {
          const created = await tx.listing.create({
            data: {
              itemId: acquiredItem.id,
              channel: d.channel,
              state: effectiveListingState,
              title,
              titleCustomized: false,
              suggestedPrice: suggestion.pricePence,
              listPrice: d.listPricePence ?? null,
              listedAt: effectiveListingState === "ACTIVE" ? new Date() : null,
            },
            select: { id: true },
          });

          if (effectiveListingState === "ACTIVE") {
            await tx.inventoryItem.update({
              where: { id: acquiredItem.id },
              data: { status: "LISTED" },
            });
          }

          return created.id;
        })
        .catch((err) => {
          listingWarning = err instanceof Error ? err.message : "Listing draft could not be created.";
          console.warn("[acquire] draft listing skipped:", listingWarning);
          return null;
        });
    }

    const item = await getPrisma().inventoryItem.findUnique({
      where: { id: acquiredItem.id },
      include: inventoryItemUiInclude,
    });
    if (!item) throw new Error("Acquired stock row could not be reloaded.");
    const createdListing = createdListingId
      ? item.listings.find((candidate) => candidate.id === createdListingId) ?? null
      : null;
    const listing = createdListing ? { ...createdListing, item } : null;

    return NextResponse.json({
      item,
      suggestion,
      comp: pricingComp,
      comps: { ...responseComps, catalog: responseCatalog, cardImage },
      catalog: responseCatalog,
      cardImage,
      listing,
      listingWarning,
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

function reviewedCompResult(
  result: {
    source: string;
    medianPence: number;
    meanPence: number;
    lowPence: number;
    highPence: number;
    sampleSize: number;
    windowDays: number;
    trendPct: number | null;
    outliersRemoved: number;
    asOf: string;
  },
  card: CardRef,
  grade: CompResult["grade"],
): CompResult {
  return { ...result, card, grade, currency: "GBP" };
}

async function replayAcquire(clientMutationId: string, strategy: "quick" | "market" | "patient") {
  const item = await getPrisma().inventoryItem.findUnique({
    where: { clientMutationId },
    include: inventoryItemUiInclude,
  });
  if (!item) return null;
  const storedListing = item.listings[0] ?? null;
  const listing = storedListing ? { ...storedListing, item } : null;
  return NextResponse.json({
    item,
    suggestion: {
      pricePence: storedListing?.suggestedPrice ?? storedListing?.listPrice ?? 0,
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
