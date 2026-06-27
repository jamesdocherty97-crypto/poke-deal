import { getPrisma } from "../db/prisma.js";
import { mapTcgDexSetCards, TcgDexCatalogSource } from "./tcgDex.js";
import { toCardData } from "./prismaCardCache.js";

export interface CatalogSyncStats {
  source: "tcgdex";
  setsSeen: number;
  setsSynced: number;
  cardsSeen: number;
  cardsSynced: number;
  cardsWithImages: number;
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
      batch.map((card) => {
        const data = toCardData(card);
        return db.card.upsert({
          where: { tcgDexId: card.tcgDexId },
          create: data,
          update: data,
        });
      }),
    );
    stats.cardsSynced += batch.length;
  }

  return stats;
}

function chunks<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
