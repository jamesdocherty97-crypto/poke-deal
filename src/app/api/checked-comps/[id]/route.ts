import { NextResponse } from "next/server";
import { z } from "zod";
import { toCardRef } from "@/lib/catalog/prismaCardCache";
import { getPrisma } from "@/lib/db/prisma";
import { normalizeRawCondition } from "@/lib/comps/pricing";
import {
  CheckedCompVoidError,
  PrismaCheckedCompRepo,
  checkedCompEntriesFromAggregate,
  mapCheckedCompsToComp,
  type CheckedCompDb,
} from "@/lib/comps/sources/checkedComps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const voidSchema = z.object({
  reason: z.string().trim().min(1).max(300),
}).strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Checked comps need a database connection." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = voidSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid checked comp void request",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    const repo = new PrismaCheckedCompRepo(getPrisma() as unknown as CheckedCompDb);
    const entry = await repo.void(id, parsed.data.reason);
    const card = toCardRef(entry.card);
    const condition = entry.grade === "RAW" ? normalizeRawCondition(entry.condition) ?? undefined : undefined;
    const rows = await repo.list(card, entry.grade, 90, condition);
    const aggregate = mapCheckedCompsToComp(rows, {
      source: "checked-comps",
      card,
      grade: entry.grade,
      condition,
      windowDays: 90,
    });
    const entries = checkedCompEntriesFromAggregate(aggregate, rows);
    const voidedEntry = entries.find((row) => {
      if (!row || typeof row !== "object" || !("id" in row)) return false;
      return (row as { id?: unknown }).id === entry.id;
    }) ?? null;

    return NextResponse.json({ entry: voidedEntry, entries, aggregate });
  } catch (error) {
    if (error instanceof CheckedCompVoidError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not-found" ? 404 : 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "checked comp void failed" },
      { status: 500 },
    );
  }
}
