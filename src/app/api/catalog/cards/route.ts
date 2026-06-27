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
import type { CatalogCard } from "@/lib/catalog/types";
import { getPrisma } from "@/lib/db/prisma";
import type { Game, Language } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const setName = searchParams.get("set") ?? undefined;
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 20) : 8;

  if (!q.trim()) return NextResponse.json({ cards: [] });

  const lookup = normalizeCatalogCardSearchInput(q, setName);
  const parsedQuery = parseCardSearchQuery(lookup.query);
  const localCards = await findLocalCards(lookup.query, lookup.setName, parsedQuery).catch(() => []);
  const localRanked = rankCatalogCards(lookup.query, localCards, { setName: lookup.setName, limit });

  let liveCards: CatalogCard[] = [];
  if (localRanked.length < limit) {
    const source = new PokemonTcgApiCatalogSource();
    const liveName = lookup.name || parsedQuery.name || q;
    liveCards = await source
      .search({ name: liveName, number: lookup.number ?? parsedQuery.number, setName: lookup.setName, game: "POKEMON", language: "EN" }, limit)
      .catch(() => []);
    await cacheCatalogCards(liveCards).catch((err) => {
      console.warn("[catalog/cards] live card cache skipped:", err instanceof Error ? err.message : "unknown error");
    });
  }
  let tcgDexCards: CatalogCard[] = [];
  if (localRanked.length + liveCards.length < limit) {
    const source = new TcgDexCatalogSource();
    const liveName = lookup.name || parsedQuery.name || q;
    tcgDexCards = await source
      .search({ name: liveName, number: lookup.number ?? parsedQuery.number, setName: lookup.setName, game: "POKEMON", language: "EN" }, limit)
      .catch(() => []);
    await cacheCatalogCards(tcgDexCards).catch((err) => {
      console.warn("[catalog/cards] tcgdex card cache skipped:", err instanceof Error ? err.message : "unknown error");
    });
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
    { setName: lookup.setName, limit },
  );
  const setMatchedCards = lookup.setName
    ? rankedCards.filter((card) => catalogCardMatchesSetContext(card, lookup.setName))
    : [];
  const cards = setMatchedCards.length > 0 ? setMatchedCards.slice(0, limit) : rankedCards;
  return NextResponse.json({ cards });
}

async function findLocalCards(
  q: string,
  setName: string | undefined,
  parsedQuery: ParsedCardSearchQuery,
): Promise<CatalogCard[]> {
  const db = getPrisma();
  const nameQuery = parsedQuery.name || q;
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

  return [...containsMatches, ...recentMatches].map(dbCardToCatalogCard);
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

function normalizeCachedCardNumber(card: DbCard): string | undefined {
  const number = card.number?.trim();
  if (!number) return undefined;

  if (card.setCode === "svp" || card.setCode === "mep") {
    const match = number.match(/^0*(\d{1,3})(?:\/\d+)?$/);
    if (match) return `${card.setCode.toUpperCase()}${match[1]!.padStart(3, "0")}`;
  }

  return number;
}
