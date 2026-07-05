import { getPrisma } from "../db/prisma.js";
import type { CatalogCard } from "./types.js";
import { PokemonTcgApiCatalogSource } from "./pokemonTcgApi.js";
import { mapTcgDexSetCards, TcgDexCatalogSource } from "./tcgDex.js";
import { toCardData, type PrismaCardData } from "./prismaCardCache.js";

export interface CatalogSyncStats {
  source: "tcgdex" | "pokemon-tcg-api";
  setsSeen?: number;
  setsSynced?: number;
  pagesSeen?: number;
  cardsSeen: number;
  cardsSynced: number;
  cardsWithImages: number;
  totalAvailable?: number;
}

export async function syncTcgDexCatalog(): Promise<CatalogSyncStats> {
  const source = new TcgDexCatalogSource();
  const db = getPrisma();
  const sets = await source.listPhysicalSets();
  const cards = sets.flatMap((set) => mapTcgDexSetCards(set));
  const stats: CatalogSyncStats = {
    source: "tcgdex",
    setsSeen: sets.length,
    setsSynced: sets.length,
    cardsSeen: cards.length,
    cardsSynced: 0,
    cardsWithImages: cards.filter((card) => card.imageUrl).length,
  };

  for (const batch of chunks(cards.filter((card) => card.tcgDexId), 25)) {
    await Promise.all(
      batch.map((card) => upsertCatalogCard(db, card)),
    );
    stats.cardsSynced += batch.length;
  }

  return stats;
}

export async function syncPokemonTcgApiCatalog(
  options: { pageSize?: number; maxPages?: number; startPage?: number } = {},
): Promise<CatalogSyncStats> {
  const source = new PokemonTcgApiCatalogSource(undefined, fetch, undefined, 15000);
  const db = getPrisma();
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages && options.maxPages > 0 ? options.maxPages : Number.POSITIVE_INFINITY;
  const startPage = options.startPage && options.startPage > 0 ? options.startPage : 1;
  const stats: CatalogSyncStats = {
    source: "pokemon-tcg-api",
    pagesSeen: 0,
    cardsSeen: 0,
    cardsSynced: 0,
    cardsWithImages: 0,
  };

  for (let pageOffset = 0; pageOffset < maxPages; pageOffset += 1) {
    const page = startPage + pageOffset;
    const result = await readPokemonTcgPageWithRetry(source, page, pageSize);
    stats.pagesSeen = (stats.pagesSeen ?? 0) + 1;
    stats.totalAvailable = result.totalCount;
    stats.cardsSeen += result.cards.length;
    stats.cardsWithImages += result.cards.filter((card) => card.imageUrl).length;

    for (const batch of chunks(result.cards.filter((card) => card.tcgApiId), 25)) {
      await Promise.all(batch.map((card) => upsertCatalogCard(db, card)));
      stats.cardsSynced += batch.length;
    }

    if (result.count <= 0 || result.cards.length <= 0) break;
    if (result.totalCount && page * result.pageSize >= result.totalCount) break;
  }

  return stats;
}

async function readPokemonTcgPageWithRetry(
  source: PokemonTcgApiCatalogSource,
  page: number,
  pageSize: number,
) {
  let lastResult = await source.listCardsPage(page, pageSize);
  for (let attempt = 1; attempt <= 2 && lastResult.cards.length === 0 && lastResult.count === 0; attempt += 1) {
    await sleep(800 * attempt);
    lastResult = await source.listCardsPage(page, pageSize);
  }
  return lastResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunks<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function upsertCatalogCard(db: ReturnType<typeof getPrisma>, card: CatalogCard) {
  const data = toCardData(card);
  const existingById = await findExistingByProviderId(db, data);
  if (existingById) {
    return db.card.update({
      where: { id: existingById.id },
      data: mergeCardDataForUpdate(existingById, data),
    });
  }

  const existingByIdentity = await db.card.findFirst({
    where: {
      game: data.game,
      language: data.language,
      name: data.name,
      setName: data.setName,
      ...(data.number ? { number: data.number } : {}),
    },
  });
  if (existingByIdentity) {
    return db.card.update({
      where: { id: existingByIdentity.id },
      data: mergeCardDataForUpdate(existingByIdentity, data),
    });
  }

  return db.card.create({ data });
}

async function findExistingByProviderId(db: ReturnType<typeof getPrisma>, data: PrismaCardData) {
  if (data.tcgApiId) {
    const existing = await db.card.findUnique({ where: { tcgApiId: data.tcgApiId } });
    if (existing) return existing;
  }
  if (data.tcgDexId) {
    const existing = await db.card.findUnique({ where: { tcgDexId: data.tcgDexId } });
    if (existing) return existing;
  }
  return null;
}

function mergeCardDataForUpdate<T extends { imageUrl: string | null; displayImageUrl?: string | null; tcgApiId: string | null; tcgDexId: string | null }>(
  existing: T,
  data: PrismaCardData,
): PrismaCardData {
  return {
    ...data,
    imageUrl: data.imageUrl ?? existing.imageUrl ?? undefined,
    displayImageUrl: data.displayImageUrl ?? existing.displayImageUrl ?? undefined,
    tcgApiId: data.tcgApiId ?? existing.tcgApiId ?? undefined,
    tcgDexId: data.tcgDexId ?? existing.tcgDexId ?? undefined,
  };
}
