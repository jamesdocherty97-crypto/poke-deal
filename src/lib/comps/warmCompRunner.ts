import { getPrisma } from "../db/prisma.js";
import type { Grade } from "../domain/types.js";
import { createAppCompService } from "./appCompLookup.js";
import { PrismaCompResultRepo } from "./prismaCompResultRepo.js";
import { warmComps, type WarmCompOptions, type WarmCompSummary, type WarmCompItem } from "./warmComps.js";
import { getPokeTraceHealth, resetPokeTraceRunStats } from "./sources/pokeTrace.js";

type WarmInventoryItem = {
  id: string;
  grade: Grade;
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

export async function runInventoryCompWarmup(options: WarmCompOptions = {}): Promise<WarmCompSummary> {
  const db = getPrisma();
  const items = await db.inventoryItem.findMany({
    where: { status: { in: ["IN_STOCK", "LISTED", "RESERVED"] } },
    include: { card: true },
    orderBy: { updatedAt: "desc" },
    take: Math.max(options.limit ?? 100, 100),
  });
  const warmItems = toWarmItems(items as WarmInventoryItem[]);
  const compService = createAppCompService();
  const compRepo = new PrismaCompResultRepo();
  resetPokeTraceRunStats();

  const summary = await warmComps(
    warmItems,
    async (item) => {
      const result = await compService.lookup(item.card, { grade: item.grade });
      return result.headline;
    },
    options,
  );

  for (const success of summary.successes) {
    await compRepo.create(success.headline).catch((err) => {
      console.warn("[warm-comps] comp persistence skipped:", err instanceof Error ? err.message : "unknown error");
    });
  }

  const pokeTrace = getPokeTraceHealth();
  return {
    ...summary,
    sourceStats: [
      {
        source: "poketrace",
        calls: pokeTrace.stats.calls,
        rateLimited: pokeTrace.stats.rateLimited,
        forbidden: pokeTrace.stats.forbidden,
        cooldowns: pokeTrace.stats.cooldowns,
        inCooldown: pokeTrace.inCooldown,
        cooldownReason: pokeTrace.cooldownReason,
        persistentKeyProblem: pokeTrace.persistentKeyProblem,
      },
    ],
  };
}

function toWarmItems(items: WarmInventoryItem[]): WarmCompItem[] {
  const seen = new Set<string>();
  const rows: WarmCompItem[] = [];
  for (const item of items) {
    const key = `${item.card.id}:${item.grade}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: item.id,
      grade: item.grade,
      card: {
        id: item.card.id,
        name: item.card.name,
        setName: item.card.setName,
        number: item.card.number ?? undefined,
        tcgApiId: item.card.tcgApiId ?? undefined,
        game: item.card.game,
        language: item.card.language,
      },
    });
  }
  return rows;
}
