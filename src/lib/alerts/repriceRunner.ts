import { getPrisma } from "../db/prisma.js";
import { CompService } from "../comps/compService.js";
import type { CardRef } from "../domain/types.js";
import { formatRepriceDigest, recommendReprice, type RepriceRecommendation } from "./repricing.js";
import { notifierFromEnv } from "./notifier.js";

export async function runRepriceCheck({
  notify = false,
  limit = 10,
  thresholdPct = 10,
}: {
  notify?: boolean;
  limit?: number;
  thresholdPct?: number;
}) {
  const notifierConfigured = Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());
  if (limit <= 0) {
    return {
      recommendations: [],
      notified: false,
      notifierConfigured,
      scannedCount: 0,
      thresholdPct,
      checkedAt: new Date().toISOString(),
    };
  }

  const items = await getPrisma().inventoryItem.findMany({
    where: { status: { in: ["IN_STOCK", "LISTED"] } },
    include: {
      card: true,
      listings: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  const recommendations: RepriceRecommendation[] = [];
  const compService = CompService.default();

  for (const item of items) {
    const listing = item.listings[0];
    const currentPricePence = listing?.listPrice ?? listing?.suggestedPrice ?? 0;
    const card: CardRef = {
      id: item.card.id,
      name: item.card.name,
      setName: item.card.setName,
      number: item.card.number ?? undefined,
      tcgApiId: item.card.tcgApiId ?? undefined,
      game: item.card.game,
      language: item.card.language,
    };
    const comps = await compService.lookup(card, { grade: item.grade });
    const recommendation = recommendReprice({
      itemId: item.id,
      cardName: item.card.name,
      grade: item.grade,
      currentPricePence,
      costBasisPence: item.costBasis,
      comp: comps.headline,
      condition: item.condition,
      thresholdPct,
      sourcesDisagree: comps.sourcesDisagree,
    });
    if (recommendation) recommendations.push(recommendation);
  }

  let notified = false;
  if (notify && recommendations.length > 0) {
    await notifierFromEnv().notify({
      title: "Poke Deal repricing",
      body: formatRepriceDigest(recommendations),
    });
    notified = notifierConfigured;
  }

  return {
    recommendations,
    notified,
    notifierConfigured,
    scannedCount: items.length,
    thresholdPct,
    checkedAt: new Date().toISOString(),
  };
}
