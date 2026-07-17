import { createAppCompService } from "../comps/appCompLookup.js";
import { getPrisma } from "../db/prisma.js";
import type { CardRef, Grade } from "../domain/types.js";
import {
  snapshotDate,
  snapshotKey,
  summarizePortfolioHistory,
  type PortfolioHolding,
  type PortfolioSnapshotRow,
} from "./portfolio.js";

type SnapshotInventoryItem = {
  id: string;
  grade: Grade;
  quantity: number;
  status: "IN_STOCK" | "LISTED" | "RESERVED" | "SOLD";
  card: {
    id: string;
    name: string;
    setName: string;
    number: string | null;
    tcgApiId: string | null;
    game: "POKEMON" | "SOCCER";
    language: "EN" | "JP";
  };
};

type SnapshotGroup = {
  card: CardRef & { id: string };
  grade: Grade;
  quantity: number;
};

export async function runPortfolioSnapshot({ limit = 25 }: { limit?: number } = {}) {
  const prisma = getPrisma();
  const groups = (await readActiveGroups()).slice(0, limit);
  const takenAt = snapshotDate();
  const compService = createAppCompService();
  let written = 0;
  let skipped = 0;

  for (const group of groups) {
    const comps = await compService.lookup(group.card, { grade: group.grade });
    if (!comps.headline || comps.headline.sampleSize === 0 || comps.headline.medianPence <= 0) {
      skipped += 1;
      continue;
    }
    const marketPence = comps.headline.medianPence;

    await prisma.priceSnapshot.upsert({
      where: {
        cardId_grade_takenAt: {
          cardId: group.card.id,
          grade: group.grade,
          takenAt,
        },
      },
      create: {
        cardId: group.card.id,
        grade: group.grade,
        marketPence,
        takenAt,
      },
      update: { marketPence },
    });
    written += 1;
  }

  const summary = await readPortfolioHistory();
  return {
    ...summary,
    written,
    skipped,
    scannedCount: groups.length,
    checkedAt: new Date().toISOString(),
  };
}

export async function readPortfolioHistory() {
  const holdings = await readActiveHoldings();
  const snapshots = await getPrisma().priceSnapshot.findMany({
    where: {
      cardId: { in: holdings.map((holding) => holding.cardId) },
      takenAt: { gte: daysAgo(30) },
    },
    orderBy: { takenAt: "asc" },
  });

  return summarizePortfolioHistory(holdings, snapshots as PortfolioSnapshotRow[]);
}

async function readActiveHoldings(): Promise<PortfolioHolding[]> {
  return readActiveGroups().then((groups) =>
    groups.map((group) => ({
      cardId: group.card.id,
      grade: group.grade,
      quantity: group.quantity,
    })),
  );
}

async function readActiveGroups(): Promise<SnapshotGroup[]> {
  const items: SnapshotInventoryItem[] = await getPrisma().inventoryItem.findMany({
    where: { status: { in: ["IN_STOCK", "LISTED", "RESERVED"] } },
    include: { card: true },
    orderBy: { updatedAt: "desc" },
  });
  const groups = new Map<string, SnapshotGroup>();

  for (const item of items) {
    const key = snapshotKey(item.card.id, item.grade);
    const current = groups.get(key);
    if (current) {
      current.quantity += item.quantity;
      continue;
    }
    groups.set(key, {
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
    });
  }

  return [...groups.values()];
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
