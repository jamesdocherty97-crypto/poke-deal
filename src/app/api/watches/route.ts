import { NextResponse } from "next/server";
import { z } from "zod";
import { PrismaCardCache } from "@/lib/catalog/prismaCardCache";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import { getPrisma } from "@/lib/db/prisma";
import type { CardRef, Grade } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gradeSchema = z.enum([
  "RAW",
  "PSA_1", "PSA_2", "PSA_3", "PSA_4", "PSA_5",
  "PSA_6", "PSA_7", "PSA_8", "PSA_9", "PSA_10",
  "BGS_9", "BGS_9_5", "BGS_10",
  "CGC_9", "CGC_9_5", "CGC_10",
]);

const watchSchema = z.object({
  card: z.object({
    name: z.string().min(1),
    setName: z.string().min(1).optional(),
    number: z.string().min(1).optional(),
    tcgApiId: z.string().min(1).optional(),
  }),
  grade: gradeSchema.default("RAW"),
  targetPence: z.coerce.number().int().positive(),
});

export async function GET() {
  try {
    const watches = await getPrisma().watch.findMany({
      include: {
        card: true,
        alerts: { orderBy: { firedAt: "desc" }, take: 1 },
      },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ watches });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "watch lookup failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = watchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid watch",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const prisma = getPrisma();
    const cache = new PrismaCardCache(prisma, new PokemonTcgApiCatalogSource());
    const card = await cache.resolve({ ...parsed.data.card, game: "POKEMON", language: "EN" } as CardRef);
    const watch = await prisma.watch.create({
      data: {
        cardId: card.id,
        grade: parsed.data.grade as Grade,
        targetPence: parsed.data.targetPence,
      },
      include: {
        card: true,
        alerts: { orderBy: { firedAt: "desc" }, take: 1 },
      },
    });
    return NextResponse.json({ watch }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "watch create failed" },
      { status: 500 },
    );
  }
}
