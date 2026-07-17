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
import { evaluateCatalogIdentity } from "@/lib/catalog/identityConfidence";

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
  displayImageUrl: string | null;
  tcgApiId: string | null;
  tcgDexId: string | null;
  cardmarketId: string | null;
  edition: string | null;
  finish: string | null;
  updatedAt: Date;
};

type CatalogCardSuggestion = CatalogCard & {
  sourceLabel: string;
  matchLabel: string;
  variantLabel: string;
  identityConfidence: "high" | "medium" | "low";
  identityReasons: string[];
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const setName = searchParams.get("set") ?? undefined;
  const language: Language = searchParams.get("language")?.toUpperCase() === "JP" || /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u.test(q) ? "JP" : "EN";
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 24) : 12;

  if (!q.trim()) return NextResponse.json({ cards: [] });

  const lookup = normalizeCatalogCardSearchInput(q, setName);
  const sourceSetName = isGenericPromoSetContext(lookup.setName) ? undefined : lookup.setName;
  const parsedQuery = parseCardSearchQuery(lookup.query);
  const rankingPoolLimit = Math.max(limit * 3, 20);
  const localCards = await findLocalCards(lookup.query, lookup.setName, parsedQuery, language).catch(() => []);
  const localRanked = rankCatalogCards(lookup.query, localCards, { setName: lookup.setName, limit: rankingPoolLimit });

  let liveCards: CatalogCard[] = [];
  let tcgDexCards: CatalogCard[] = [];
  const hasExactLocal = localRanked.some((card) =>
    (!lookup.number || normalizePreviewNumber(card.number ?? "") === normalizePreviewNumber(lookup.number)) &&
    (!lookup.setName || catalogCardMatchesSetContext(card, lookup.setName)),
  );
  if (localRanked.length < limit || !hasExactLocal || Boolean(lookup.number)) {
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
        language === "EN"
          ? pokemonTcgSource.search({ name: liveName, number: lookup.number ?? parsedQuery.number, setName: sourceSetName, game: "POKEMON", language }, Math.max(limit, 12), { signal: request.signal })
          : Promise.resolve([]),
        [],
        TYPEAHEAD_POKEMON_TCG_TIMEOUT_MS,
      ),
      settleTypeaheadSource(
        tcgDexSource.search({ name: liveName, number: lookup.number ?? parsedQuery.number, setName: sourceSetName, game: "POKEMON", language }, Math.max(limit, 12), { signal: request.signal }),
        [],
        TYPEAHEAD_TCGDEX_TIMEOUT_MS,
      ),
    ]);

    const retrievedAt = new Date().toISOString();
    liveCards = pokemonTcgCards.map((card) => ({ ...card, provenance: { origin: "live", providers: ["pokemon-tcg-api"], retrievedAt } }));
    tcgDexCards = allTcgDexCards.map((card) => ({ ...card, provenance: { origin: "live", providers: ["tcgdex"], retrievedAt } }));
    cacheCatalogCardsInBackground(liveCards, "live");
    cacheCatalogCardsInBackground(allTcgDexCards, "tcgdex");
  }

  const chaseCards = searchChaseCards(lookup.query, lookup.setName, limit);
  const promoFallback = buildPromoCatalogFallback({
    name: lookup.name || q,
    setName: lookup.setName,
    number: lookup.number ?? parsedQuery.number,
    game: "POKEMON",
    language,
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
  language: Language,
): Promise<CatalogCard[]> {
  const db = getPrisma();
  const nameQuery = parsedQuery.name || q;
  const [nameMatches, containsMatches, recentMatches] = await Promise.all([db.card.findMany({
    where: {
      game: "POKEMON",
      language,
      name: { contains: nameQuery, mode: "insensitive" },
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
  }), db.card.findMany({
    where: {
      game: "POKEMON",
      language,
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
  }), db.card.findMany({
    where: {
      game: "POKEMON",
      language,
      ...(setName ? { setName: { contains: setName, mode: "insensitive" as const } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 120,
  })]);

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
    displayImageUrl: card.displayImageUrl ?? undefined,
    tcgApiId: card.tcgApiId ?? undefined,
    tcgDexId: card.tcgDexId ?? undefined,
    cardmarketId: card.cardmarketId ?? undefined,
    edition: card.edition as CatalogCard["edition"],
    finish: card.finish as CatalogCard["finish"],
    provenance: {
      origin: "cache",
      providers: [card.tcgApiId ? "pokemon-tcg-api" : null, card.tcgDexId ? "tcgdex" : null, card.cardmarketId ? "cardmarket" : null]
        .filter((value): value is string => Boolean(value)),
      cachedAt: card.updatedAt.toISOString(),
    },
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
    ...catalogIdentityConfidence(card, lookup),
  };
}

function catalogSourceLabel(card: CatalogCard): string {
  const age = card.provenance?.cachedAt ? ` · cached ${formatCompactAge(card.provenance.cachedAt)}` : "";
  const live = card.provenance?.origin === "live" ? " · live" : age;
  if (card.tcgApiId && card.tcgDexId) return `Pokemon TCG + TCGdex${live}`;
  if (card.tcgApiId) return `Pokemon TCG API${live}`;
  if (card.tcgDexId) return `TCGdex${live}`;
  return "Curated/manual";
}

function catalogMatchLabel(card: CatalogCard, lookup: { name: string; setName?: string; number?: string }): string {
  if (lookup.number && card.number && normalizePreviewNumber(lookup.number) === normalizePreviewNumber(card.number)) {
    return "Exact number";
  }
  if (lookup.setName && catalogCardMatchesSetContext(card, lookup.setName)) {
    return "Set match";
  }
  if (lookup.name && card.name) return "Name match";
  return "Catalog candidate";
}

function catalogVariantLabel(card: CatalogCard): string {
  return [card.edition?.replace(/_/g, " "), card.finish?.replace(/_/g, " "), card.language, card.rarity, card.number ? `#${card.number}` : null].filter(Boolean).join(" · ") || "variant";
}

function catalogIdentityConfidence(card: CatalogCard, lookup: { name: string; setName?: string; number?: string }) {
  const verdict = evaluateCatalogIdentity({ name: lookup.name, setName: lookup.setName, number: lookup.number, game: "POKEMON", language: card.language }, card);
  return {
    identityConfidence: verdict.level,
    identityReasons: [...verdict.reasons, ...verdict.conflicts],
  };
}

function formatCompactAge(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
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
