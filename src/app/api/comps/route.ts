// Vertical-slice API: GET /api/comps?name=Charizard ex&number=199/165&grade=RAW
// Returns the reconciled comp for a card+grade. Runs in fixture mode until keys are set.

import { NextResponse } from "next/server";
import {
  catalogToCardRef,
  createAppCompService,
  findAmbiguousCatalogCandidates,
  findCatalogAlternatives,
  requestHasExplicitCardNumber,
  resolveCatalogCard,
} from "@/lib/comps/appCompLookup";
import { PrismaCompResultRepo } from "@/lib/comps/prismaCompResultRepo";
import { readCompLookupRequest } from "@/lib/comps/request";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import type { CatalogCard } from "@/lib/catalog/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECOVERY_ALTERNATIVES_TIMEOUT_MS = 1600;
const CATALOG_RESOLVE_TIMEOUT_MS = 3600;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lookup = readCompLookupRequest(searchParams);
  if ("error" in lookup) return NextResponse.json({ error: lookup.error }, { status: 400 });
  const { card, grade } = lookup;

  try {
    const catalogSource = new PokemonTcgApiCatalogSource();
    const catalog = await resolveCatalogCard(card, catalogSource, { timeoutMs: CATALOG_RESOLVE_TIMEOUT_MS });
    const compCard = catalog ? catalogToCardRef(catalog, card) : card;
    const compService = createAppCompService(catalogSource, catalog);

    // A bare query with no explicit collector number can resolve to one of
    // several same-set sibling printings (e.g. Umbreon V vs VMAX vs the
    // "Moonbreon" alt art). Kick that candidate search off now, concurrently
    // with the price lookup below, so disambiguation never adds latency on
    // top of comp aggregation in the common case where a price is found.
    const explicitNumber = requestHasExplicitCardNumber(card) || Boolean(card.tcgApiId);
    const ambiguousCandidatesPromise = explicitNumber
      ? null
      : findAmbiguousCatalogCandidates(card, catalogSource, 8, { timeoutMs: RECOVERY_ALTERNATIVES_TIMEOUT_MS });

    const result = await compService.lookup(compCard, { grade });
    const needsRecovery = !catalog || result.headline.sampleSize === 0 || result.headline.medianPence <= 0;

    let alternatives: CatalogCard[] = [];
    let ambiguous = false;
    const ambiguousCandidates = ambiguousCandidatesPromise ? await ambiguousCandidatesPromise : [];
    const ambiguityAlternatives = catalog
      ? ambiguousCandidates.filter((candidate) => catalogIdentityKey(candidate) !== catalogIdentityKey(catalog))
      : ambiguousCandidates;
    ambiguous = ambiguityAlternatives.length > 0;

    if (needsRecovery) {
      const recovery = await findCatalogAlternatives(card, catalogSource, 4, { timeoutMs: RECOVERY_ALTERNATIVES_TIMEOUT_MS });
      alternatives = dedupeCatalogCards([...ambiguityAlternatives, ...recovery]).slice(0, 8);
    } else if (ambiguous) {
      alternatives = ambiguityAlternatives;
    }
    if (process.env.DATABASE_URL) {
      await new PrismaCompResultRepo().create(result.headline).catch((err) => {
        console.warn(
          "[comps] comp persistence skipped:",
          err instanceof Error ? err.message : "unknown error",
        );
      });
    }
    return NextResponse.json({ ...result, catalog, alternatives, ambiguous });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed" },
      { status: 502 },
    );
  }
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

function dedupeCatalogCards(cards: CatalogCard[]): CatalogCard[] {
  const seen = new Set<string>();
  const deduped: CatalogCard[] = [];
  for (const card of cards) {
    const key = catalogIdentityKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(card);
  }
  return deduped;
}
