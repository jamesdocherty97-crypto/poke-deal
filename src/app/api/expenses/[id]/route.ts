import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const categorySchema = z.enum(["SUPPLIES", "POSTAGE", "GRADING", "TABLE_FEE", "TRAVEL", "PLATFORM", "OTHER"]);
const channelSchema = z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]);

const expensePatchSchema = z.object({
  category: categorySchema.optional(),
  description: z.string().trim().min(1).optional(),
  amountPence: z.coerce.number().int().positive().optional(),
  spentAt: z.coerce.date().optional(),
  channel: channelSchema.nullish(),
  source: z.string().trim().min(1).nullish(),
  notes: z.string().trim().min(1).nullish(),
}).refine(
  (value) =>
    value.category !== undefined ||
    value.description !== undefined ||
    value.amountPence !== undefined ||
    value.spentAt !== undefined ||
    value.channel !== undefined ||
    value.source !== undefined ||
    value.notes !== undefined,
  { message: "at least one expense field is required" },
);

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const parsed = expensePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid expense update",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }

  const d = parsed.data;
  try {
    const expense = await getPrisma().expense.update({
      where: { id: params.id },
      data: {
        ...(d.category !== undefined ? { category: d.category } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.amountPence !== undefined ? { amount: d.amountPence } : {}),
        ...(d.spentAt !== undefined ? { spentAt: d.spentAt } : {}),
        ...(d.channel !== undefined ? { channel: d.channel } : {}),
        ...(d.source !== undefined ? { source: d.source } : {}),
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
      },
    });
    return NextResponse.json({ expense });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "expense update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    await getPrisma().expense.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "expense delete failed" },
      { status: 500 },
    );
  }
}
