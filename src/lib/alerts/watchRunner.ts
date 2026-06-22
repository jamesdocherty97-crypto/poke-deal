import { CompService } from "../comps/compService.js";
import { getPrisma } from "../db/prisma.js";
import type { CardRef } from "../domain/types.js";
import { notifierFromEnv } from "./notifier.js";
import { checkWatch, formatWatchDigest, type WatchHit } from "./watchlist.js";

export async function runWatchCheck({ notify = false, limit = 10 }: { notify?: boolean; limit?: number }) {
  const notifierConfigured = Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());
  if (limit <= 0) {
    return {
      hits: [],
      notified: false,
      notifierConfigured,
      scannedCount: 0,
      checkedAt: new Date().toISOString(),
    };
  }

  const prisma = getPrisma();
  const watches = await prisma.watch.findMany({
    where: { active: true },
    include: { card: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const compService = CompService.default();
  const hits: WatchHit[] = [];

  for (const watch of watches) {
    const card: CardRef = {
      id: watch.card.id,
      name: watch.card.name,
      setName: watch.card.setName,
      number: watch.card.number ?? undefined,
      tcgApiId: watch.card.tcgApiId ?? undefined,
      game: watch.card.game,
      language: watch.card.language,
    };
    const comps = await compService.lookup(card, { grade: watch.grade });
    const hit = checkWatch({
      watchId: watch.id,
      cardName: watch.card.name,
      grade: watch.grade,
      targetPence: watch.targetPence,
      comp: comps.headline,
    });
    if (!hit) continue;

    await prisma.alert.create({
      data: {
        watchId: watch.id,
        kind: "PRICE_DROP",
        message: hit.message,
        pence: hit.marketPence,
        delivered: notify && notifierConfigured,
      },
    });
    hits.push(hit);
  }

  let notified = false;
  if (notify && hits.length > 0) {
    await notifierFromEnv().notify({
      title: "Pokémon Dealer OS sourcing targets",
      body: formatWatchDigest(hits),
    });
    notified = notifierConfigured;
  }

  return {
    hits,
    notified,
    notifierConfigured,
    scannedCount: watches.length,
    checkedAt: new Date().toISOString(),
  };
}
