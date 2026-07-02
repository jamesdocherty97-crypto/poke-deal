import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { GRADE_VALUES } from "@/lib/domain/types";
import { allocateDealSessionCost, summarizeDealSession } from "@/lib/dealer/dealSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gradeSchema = z.enum(GRADE_VALUES);

const lineSchema = z.object({
  card: z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    setName: z.string().min(1).optional(),
    setCode: z.string().min(1).optional(),
    number: z.string().min(1).optional(),
    tcgApiId: z.string().min(1).optional(),
    tcgDexId: z.string().min(1).optional(),
    imageUrl: z.string().url().optional(),
  }),
  grade: gradeSchema.default("RAW"),
  headlinePence: z.coerce.number().int().nonnegative(),
  confidence: z.string().trim().min(1).default("low"),
  manualCheck: z.boolean().default(false),
  maxCashOfferPence: z.coerce.number().int().nonnegative().nullable().optional(),
  maxTradeOfferPence: z.coerce.number().int().nonnegative().nullable().optional(),
  dealerOfferPence: z.coerce.number().int().nonnegative().nullable().optional(),
  netProceedsPence: z.coerce.number().int().nullable().optional(),
  expectedProfitPence: z.coerce.number().int().nullable().optional(),
  sampleSize: z.coerce.number().int().nonnegative().default(0),
  windowDays: z.coerce.number().int().nonnegative().default(0),
  compSource: z.string().trim().min(1).optional(),
  compAsOf: z.string().datetime().optional(),
});

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().trim().min(1).optional() }),
  z.object({ action: z.literal("addLine"), line: lineSchema }),
  z.object({
    action: z.literal("updateLine"),
    lineId: z.string().min(1),
    dealerOfferPence: z.coerce.number().int().nonnegative().nullable(),
  }),
  z.object({ action: z.literal("removeLine"), lineId: z.string().min(1) }),
  z.object({ action: z.literal("complete"), sessionId: z.string().min(1), paidPence: z.coerce.number().int().nonnegative() }),
  z.object({ action: z.literal("abandon"), sessionId: z.string().min(1) }),
]);

export async function GET() {
  try {
    return NextResponse.json(await readOpenSessionPayload());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "deal session lookup failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid deal session request",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 400 },
    );
  }

  try {
    const prisma = getPrisma();
    const data = parsed.data;
    if (data.action === "create") {
      await getOrCreateOpenSession(data.name);
      return NextResponse.json(await readOpenSessionPayload(), { status: 201 });
    }
    if (data.action === "addLine") {
      const session = await getOrCreateOpenSession();
      const cardId = await resolveCardId(data.line.card);
      await prisma.dealSessionLine.create({
        data: {
          sessionId: session.id,
          cardId,
          name: data.line.card.name,
          setName: data.line.card.setName,
          setCode: data.line.card.setCode,
          number: data.line.card.number,
          tcgApiId: data.line.card.tcgApiId,
          tcgDexId: data.line.card.tcgDexId,
          imageUrl: data.line.card.imageUrl,
          grade: data.line.grade,
          headlinePence: data.line.headlinePence,
          confidence: data.line.confidence,
          manualCheck: data.line.manualCheck,
          maxCashOfferPence: data.line.maxCashOfferPence ?? null,
          maxTradeOfferPence: data.line.maxTradeOfferPence ?? null,
          dealerOfferPence: data.line.dealerOfferPence ?? null,
          netProceedsPence: data.line.netProceedsPence ?? null,
          expectedProfitPence: data.line.expectedProfitPence ?? null,
          sampleSize: data.line.sampleSize,
          windowDays: data.line.windowDays,
          compSource: data.line.compSource,
          compAsOf: data.line.compAsOf ? new Date(data.line.compAsOf) : null,
        },
      });
      return NextResponse.json(await readOpenSessionPayload(), { status: 201 });
    }
    if (data.action === "updateLine") {
      await prisma.dealSessionLine.update({
        where: { id: data.lineId },
        data: { dealerOfferPence: data.dealerOfferPence },
      });
      return NextResponse.json(await readOpenSessionPayload());
    }
    if (data.action === "removeLine") {
      await prisma.dealSessionLine.delete({ where: { id: data.lineId } });
      return NextResponse.json(await readOpenSessionPayload());
    }
    if (data.action === "abandon") {
      await prisma.dealSession.update({
        where: { id: data.sessionId },
        data: { status: "ABANDONED", abandonedAt: new Date() },
      });
      return NextResponse.json(await readOpenSessionPayload());
    }

    const completed = await completeSession(data.sessionId, data.paidPence);
    return NextResponse.json(completed);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "deal session action failed" },
      { status: 500 },
    );
  }
}

async function readOpenSessionPayload() {
  const session = await getPrisma().dealSession.findFirst({
    where: { status: "OPEN" },
    include: { lines: { orderBy: { addedAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  return sessionPayload(session);
}

async function getOrCreateOpenSession(name?: string) {
  const prisma = getPrisma();
  const existing = await prisma.dealSession.findFirst({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.dealSession.create({
    data: { name: name?.trim() || `Session ${new Date().toLocaleDateString("en-GB")}` },
  });
}

async function resolveCardId(card: z.infer<typeof lineSchema>["card"]): Promise<string | null> {
  const prisma = getPrisma();
  if (card.id) {
    const existing = await prisma.card.findUnique({ where: { id: card.id }, select: { id: true } });
    if (existing) return existing.id;
  }
  if (card.tcgApiId) {
    const existing = await prisma.card.findUnique({ where: { tcgApiId: card.tcgApiId }, select: { id: true } });
    if (existing) return existing.id;
    const created = await prisma.card.create({
      data: {
        name: card.name,
        setName: card.setName ?? "Unknown",
        setCode: card.setCode,
        number: card.number,
        imageUrl: card.imageUrl,
        tcgApiId: card.tcgApiId,
        tcgDexId: card.tcgDexId,
      },
      select: { id: true },
    });
    return created.id;
  }
  const existing = await prisma.card.findFirst({
    where: {
      name: card.name,
      setName: card.setName ?? "Unknown",
      number: card.number ?? null,
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.card.create({
    data: {
      name: card.name,
      setName: card.setName ?? "Unknown",
      setCode: card.setCode,
      number: card.number,
      imageUrl: card.imageUrl,
      tcgDexId: card.tcgDexId,
    },
    select: { id: true },
  });
  return created.id;
}

async function completeSession(sessionId: string, paidPence: number) {
  const prisma = getPrisma();
  const session = await prisma.dealSession.findUnique({
    where: { id: sessionId },
    include: { lines: { orderBy: { addedAt: "asc" } } },
  });
  if (!session || session.status !== "OPEN") throw new Error("Open deal session not found");
  const allocations = allocateDealSessionCost(session.lines, paidPence);
  const allocationByLine = new Map(allocations.map((allocation) => [allocation.lineId, allocation]));

  const result = await prisma.$transaction(async (tx) => {
    const items = [];
    for (const line of session.lines) {
      const allocation = allocationByLine.get(line.id);
      if (!allocation) continue;
      const cardId = line.cardId ?? (await resolveCardIdForTransaction(tx, line));
      const item = await tx.inventoryItem.create({
        data: {
          cardId,
          grade: line.grade,
          quantity: 1,
          costBasis: allocation.costBasisPence,
          acquiredFrom: session.name,
          status: "IN_STOCK",
        },
        include: { card: true },
      });
      items.push(item);
    }
    const updated = await tx.dealSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED", completedAt: new Date(), paidPence },
      include: { lines: { orderBy: { addedAt: "asc" } } },
    });
    return { session: updated, items, allocations };
  });

  return {
    ...sessionPayload(result.session),
    items: result.items,
    allocations: result.allocations,
  };
}

async function resolveCardIdForTransaction(tx: Prisma.TransactionClient, line: {
  name: string;
  setName: string | null;
  setCode: string | null;
  number: string | null;
  imageUrl: string | null;
  tcgApiId: string | null;
  tcgDexId: string | null;
}) {
  if (line.tcgApiId) {
    const existing = await tx.card.findUnique({ where: { tcgApiId: line.tcgApiId }, select: { id: true } });
    if (existing) return existing.id;
  }
  const existing = await tx.card.findFirst({
    where: { name: line.name, setName: line.setName ?? "Unknown", number: line.number },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.card.create({
    data: {
      name: line.name,
      setName: line.setName ?? "Unknown",
      setCode: line.setCode ?? undefined,
      number: line.number ?? undefined,
      imageUrl: line.imageUrl ?? undefined,
      tcgApiId: line.tcgApiId ?? undefined,
      tcgDexId: line.tcgDexId ?? undefined,
    },
    select: { id: true },
  });
  return created.id;
}

function sessionPayload<T extends { lines: Array<{
  id: string;
  headlinePence: number;
  manualCheck: boolean;
  maxCashOfferPence: number | null;
  maxTradeOfferPence: number | null;
  dealerOfferPence: number | null;
  netProceedsPence: number | null;
  expectedProfitPence: number | null;
}> } | null>(session: T) {
  if (!session) return { session: null, summary: summarizeDealSession([]) };
  return {
    session,
    summary: summarizeDealSession(session.lines),
  };
}
