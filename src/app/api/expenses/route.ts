import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const categorySchema = z.enum(["SUPPLIES", "POSTAGE", "GRADING", "TABLE_FEE", "TRAVEL", "PLATFORM", "OTHER"]);
const channelSchema = z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]);

const expenseSchema = z.object({
  category: categorySchema.default("OTHER"),
  description: z.string().trim().min(1),
  amountPence: z.coerce.number().int().positive(),
  spentAt: z.coerce.date().optional(),
  channel: channelSchema.nullish(),
  source: z.string().trim().min(1).nullish(),
  notes: z.string().trim().min(1).nullish(),
});

export async function GET() {
  try {
    const expenses = await getPrisma().expense.findMany({
      orderBy: { spentAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ expenses });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "expense lookup failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = expenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid expense",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }

  const d = parsed.data;
  try {
    const expense = await getPrisma().expense.create({
      data: {
        category: d.category,
        description: d.description,
        amount: d.amountPence,
        spentAt: d.spentAt ?? new Date(),
        channel: d.channel ?? null,
        source: d.source ?? null,
        notes: d.notes ?? null,
      },
    });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "expense create failed" },
      { status: 500 },
    );
  }
}
