import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { CompService } from "@/lib/comps/compService";
import { formatRepriceDigest, recommendReprice } from "@/lib/alerts/repricing";
import { notifierFromEnv } from "@/lib/alerts/notifier";
import type { CardRef } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const repriceSchema = z.object({
  notify: z.boolean().default(false),
  limit: z.coerce.number().int().positive().max(25).default(10),
  thresholdPct: z.coerce.number().positive().max(100).default(10),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = repriceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid reprice request",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const { notify, limit, thresholdPct } = parsed.data;
    const items = await getPrisma().inventoryItem.findMany({
      where: { status: { in: ["IN_STOCK", "LISTED"] } },
      include: {
        card: true,
        listings: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const recommendations = [];
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
      const comps = await CompService.default().lookup(card, { grade: item.grade });
      const recommendation = recommendReprice({
        itemId: item.id,
        cardName: item.card.name,
        grade: item.grade,
        currentPricePence,
        costBasisPence: item.costBasis,
        comp: comps.headline,
        thresholdPct,
        sourcesDisagree: comps.sourcesDisagree,
      });
      if (recommendation) recommendations.push(recommendation);
    }

    let notified = false;
    if (notify && recommendations.length > 0) {
      await notifierFromEnv().notify({
        title: "Pokémon Dealer OS repricing",
        body: formatRepriceDigest(recommendations),
      });
      notified = Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());
    }

    return NextResponse.json({ recommendations, notified });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "reprice check failed" },
      { status: 500 },
    );
  }
}
