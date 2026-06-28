import { NextResponse } from "next/server";
import {
  catalogCardMatchesSetContext,
  normalizeCatalogCardSearchInput,
  parseCardSearchQuery,
  rankCatalogCards,
  type ParsedCardSearchQuery,
} from "@/lib/catalog/cardSearch";
import { searchChaseCards } from "@/lib/catalog/chaseCards";
import { buildPromoCatalogFallback } from "@/lib/catalog/promoFallback";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import { toCardData } from "@/lib/catalog/prismaCardCache";
import { TcgDexCatalogSource } from "@/lib/catalog/tcgDex";
import { settleTypeaheadSource } from "@/lib/catalog/typeahead";
import type { CatalogCard } from "@/lib/catalog/types";
import { getPrisma } from "@/lib/db/prisma";
import type { Game, Language } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPEAHEAD_POKEMON_TCG_TIMEOUT_MS = 1200;
const TYPEAHEAD_TCGDEX_TIMEOUT_MS = 1400;

type DbCard = {
  id: string;
  game: Game;
  language: Language;
  name: string;
  setName: string;
  setCode: string | null;
  number: string | null;
  rarity: string | null;
  imageUrl: string | null;
  tcgApiId: string | null;
  tcgDexId: string | null;
};

type CatalogCardSuggestion = CatalogCard & {
  sourceLabel: string;
  matchLabel: string;
  variantLabel: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const setName = searchParams.get("set") ?? undefined;
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 24) : 12;

  if (!q.trim()) return NextResponse.json({ cards: [] });

  const lookup = normalizeCatalogCardSearchInput(q, setName);
  const sourceSetName = isGenericPromoSetContext(lookup.setName) ? undefined : lookup.setName;
  const parsedQuery = parseCardSearchQuery(lookup.query);
  const rankingPoolLimit = Math.max(limit * 3, 20);
  const localCards = await findLocalCards(lookup.query, lookup.setName, parsedQuery).catch(() => []);
  const localRanked = rankCatalogCards(lookup.query, localCards, { setName: lookup.setName, limit: rankingPoolLimit });

  let liveCards: CatalogCard[] = [];
  let tcgDexCards: CatalogCard[] = [];
  if (localRanked.length < limit) {
    const liveName = lookup.name || parsedQuery.name || q;
    const pokemonTcgSource = new PokemonTcgApiCatalogSource(
      undefined,
      fetch,
      undefined,
      TYPEAHEAD_POKEMON_TCG_TIMEOUT_MS,
    );
    const tcgDexSource = new TcgDexCatalogSource(fetch, undefined, TYPEAHEAD_TCGDEX_TIMEOUT_MS);
    const [pokemonTcgCards, allTcgDexCards] = await Promise.all([
      settleTypeaheadSource(
        pokemonTcgSource.search({ name: liveName, number: lookup.number ?? parsedQuery.number, setName: sourceSetName, game: "POKEMON", language: "EN" }, Math.max(limit, 12)),
        [],
        TYPEAHEAD_POKEMON_TCG_TIMEOUT_MS,
      ),
      settleTypeaheadSource(
        tcgDexSource.search({ name: liveName, number: lookup.number ?? parsedQuery.number, setName: sourceSetName, game: "POKEMON", language: "EN" }, Math.max(limit, 12)),
        [],
        TYPEAHEAD_TCGDEX_TIMEOUT_MS,
      ),
    ]);

    liveCards = pokemonTcgCards;
    tcgDexCards = localRanked.length + liveCards.length < limit ? allTcgDexCards : [];
    cacheCatalogCardsInBackground(liveCards, "live");
    cacheCatalogCardsInBackground(allTcgDexCards, "tcgdex");
  }

  const chaseCards = searchChaseCards(lookup.query, lookup.setName, limit);
  const promoFallback = buildPromoCatalogFallback({
    name: lookup.name || q,
    setName: lookup.setName,
    number: lookup.number ?? parsedQuery.number,
    game: "POKEMON",
    language: "EN",
  });
  const rankedCards = rankCatalogCards(
    lookup.query,
    [...localRanked, ...liveCards, ...tcgDexCards, ...chaseCards, ...(promoFallback ? [promoFallback] : [])],
    { setName: lookup.setName, limit: rankingPoolLimit },
  );
  const setMatchedCards = lookup.setName
    ? rankedCards.filter((card) => catalogCardMatchesSetContext(card, lookup.setName))
    : [];
  const cards = (setMatchedCards.length > 0 ? setMatchedCards.slice(0, limit) : rankedCards.slice(0, limit)).map((card) =>
    toCatalogCardSuggestion(card, lookup),
  );
  return NextResponse.json({ cards, parsed: lookup });
}

function isGenericPromoSetContext(setName: string | undefined): boolean {
  return /^promos?$/i.test(setName?.trim() ?? "");
}

async function findLocalCards(
  q: string,
  setName: string | undefined,
  parsedQuery: ParsedCardSearchQuery,
): Promise<CatalogCard[]> {
  const db = getPrisma();
  const nameQuery = parsedQuery.name || q;
  const nameMatches = await db.card.findMany({
    where: {
      game: "POKEMON",
      language: "EN",
      name: { contains: nameQuery, mode: "insensitive" },
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });

  const containsMatches = await db.card.findMany({
    where: {
      game: "POKEMON",
      language: "EN",
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        ...(nameQuery !== q ? [{ name: { contains: nameQuery, mode: "insensitive" as const } }] : []),
        { number: { contains: q, mode: "insensitive" } },
        ...(parsedQuery.number ? [{ number: { contains: parsedQuery.number, mode: "insensitive" as const } }] : []),
        ...(setName ? [{ setName: { contains: setName, mode: "insensitive" as const } }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 120,
  });

  const recentMatches = await db.card.findMany({
    where: {
      game: "POKEMON",
      language: "EN",
      ...(setName ? { setName: { contains: setName, mode: "insensitive" as const } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 120,
  });

  return [...nameMatches, ...containsMatches, ...recentMatches].map(dbCardToCatalogCard);
}

async function cacheCatalogCards(cards: CatalogCard[]): Promise<void> {
  const db = getPrisma();
  for (const card of cards) {
    if (!card.tcgApiId && !card.tcgDexId) continue;
    const data = toCardData(card);
    if (card.tcgApiId) {
      await db.card.upsert({
        where: { tcgApiId: card.tcgApiId },
        create: data,
        update: data,
      });
    } else if (card.tcgDexId) {
      await db.card.upsert({
        where: { tcgDexId: card.tcgDexId },
        create: data,
        update: data,
      });
    }
  }
}

function cacheCatalogCardsInBackground(cards: CatalogCard[], sourceName: string): void {
  if (cards.length === 0) return;
  void cacheCatalogCards(cards).catch((err) => {
    console.warn(`[catalog/cards] ${sourceName} card cache skipped:`, err instanceof Error ? err.message : "unknown error");
  });
}

function dbCardToCatalogCard(card: DbCard): CatalogCard {
  return {
    game: card.game,
    language: card.language,
    name: card.name,
    setName: card.setName,
    setCode: card.setCode ?? undefined,
    number: normalizeCachedCardNumber(card),
    rarity: card.rarity ?? undefined,
    imageUrl: card.imageUrl ?? undefined,
    tcgApiId: card.tcgApiId ?? undefined,
    tcgDexId: card.tcgDexId ?? undefined,
  };
}

function toCatalogCardSuggestion(
  card: CatalogCard,
  lookup: { name: string; setName?: string; number?: string },
): CatalogCardSuggestion {
  return {
    ...card,
    sourceLabel: catalogSourceLabel(card),
    matchLabel: catalogMatchLabel(card, lookup),
    variantLabel: catalogVariantLabel(card),
  };
}

function catalogSourceLabel(card: CatalogCard): string {
  if (card.tcgApiId && card.tcgDexId) return "Pokemon TCG + TCGdex";
  if (card.tcgApiId) return "Pokemon TCG API";
  if (card.tcgDexId) return "TCGdex";
  return "Curated/manual";
}

function catalogMatchLabel(card: CatalogCard, lookup: { name: string; setName?: string; number?: string }): string {
  if (lookup.number && card.number && normalizePreviewNumber(lookup.number) === normalizePreviewNumber(card.number)) {
    return "Exact number";
  }
  if (lookup.setName && catalogCardMatchesSetContext(card, lookup.setName)) {
    return "Set match";
  }
  if (card.imageUrl) return "Image match";
  return "Manual candidate";
}

function catalogVariantLabel(card: CatalogCard): string {
  return [card.rarity, card.number ? `#${card.number}` : null].filter(Boolean).join(" · ") || "variant";
}

function normalizePreviewNumber(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^0+(?=\d)/, "");
}

function normalizeCachedCardNumber(card: DbCard): string | undefined {
  const number = card.number?.trim();
  if (!number) return undefined;

  if (card.setCode === "svp" || card.setCode === "mep") {
    const match = number.match(/^0*(\d{1,3})(?:\/\d+)?$/);
    if (match) return `${card.setCode.toUpperCase()}${match[1]!.padStart(3, "0")}`;
  }

  return number;
}
