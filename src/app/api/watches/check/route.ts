import { NextResponse } from "next/server";
import { z } from "zod";
import { formatWatchDigest, checkWatch } from "@/lib/alerts/watchlist";
import { notifierFromEnv } from "@/lib/alerts/notifier";
import { CompService } from "@/lib/comps/compService";
import { getPrisma } from "@/lib/db/prisma";
import type { CardRef } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkSchema = z.object({
  notify: z.boolean().default(false),
  limit: z.coerce.number().int().positive().max(25).default(10),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = checkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid watch check",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const { notify, limit } = parsed.data;
    const notifierConfigured = Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());
    const prisma = getPrisma();
    const watches = await prisma.watch.findMany({
      where: { active: true },
      include: { card: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const compService = CompService.default();
    const hits = [];

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

    return NextResponse.json({
      hits,
      notified,
      notifierConfigured,
      scannedCount: watches.length,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "watch check failed" },
      { status: 500 },
    );
  }
}
