import { CompService, defaultCompSources } from "../comps/compService.js";
import { PrismaLastKnownCompCache } from "../comps/prismaCompResultRepo.js";
import { getPrisma } from "../db/prisma.js";
import type { CardRef } from "../domain/types.js";
import { createInboxAlert } from "./inbox.js";
import { alertWebhookConfigured, notifierFromEnv } from "./notifier.js";
import { checkWatch, formatWatchDigest, shouldCreateWatchAlert, type WatchHit } from "./watchlist.js";

export async function runWatchCheck({ notify = false, limit = 10 }: { notify?: boolean; limit?: number }) {
  const notifierConfigured = alertWebhookConfigured();
  if (limit <= 0) {
    return {
      hits: [],
      notified: false,
      notifierConfigured,
      scannedCount: 0,
      skippedCount: 0,
      checkedAt: new Date().toISOString(),
    };
  }

  const prisma = getPrisma();
  const activeCount = await prisma.watch.count({ where: { active: true } });
  const watches = await prisma.watch.findMany({
    where: { active: true },
    include: { card: true, alerts: { orderBy: { firedAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const compService = new CompService(
    defaultCompSources(),
    undefined,
    process.env.DATABASE_URL ? new PrismaLastKnownCompCache() : null,
  );
  const hits: WatchHit[] = [];
  const alertHits: WatchHit[] = [];
  const alertIds: string[] = [];
  const checkedAt = new Date();

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
    hits.push(hit);

    if (!shouldCreateWatchAlert(hit, watch.alerts[0] ?? null, checkedAt)) continue;

    const alert = await prisma.alert.create({
      data: {
        watchId: watch.id,
        kind: "PRICE_DROP",
        message: hit.message,
        pence: hit.marketPence,
        delivered: false,
      },
    });
    alertIds.push(alert.id);
    alertHits.push(hit);
    await createInboxAlert(prisma, {
      kind: "PRICE_DROP",
      title: "Buy target hit",
      message: hit.message,
      pence: hit.marketPence,
      href: "/?view=pnl",
      sourceKey: `watch:${alert.id}`,
      delivered: false,
    });
  }

  let notified = false;
  if (notify && notifierConfigured && alertHits.length > 0) {
    await notifierFromEnv().notify({
      title: "Poke Deal sourcing targets",
      body: formatWatchDigest(alertHits),
    });
    notified = true;
    await prisma.alert.updateMany({
      where: { id: { in: alertIds } },
      data: { delivered: true },
    });
    await prisma.appAlert.updateMany({
      where: { sourceKey: { in: alertIds.map((id) => `watch:${id}`) } },
      data: { delivered: true },
    });
  }

  return {
    hits,
    alertsCreated: alertHits.length,
    suppressedCount: hits.length - alertHits.length,
    notified,
    notifierConfigured,
    scannedCount: watches.length,
    skippedCount: Math.max(0, activeCount - watches.length),
    checkedAt: new Date().toISOString(),
  };
}
