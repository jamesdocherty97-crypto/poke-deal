import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import type { Grade } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gradeSchema = z.enum([
  "RAW",
  "PSA_1", "PSA_2", "PSA_3", "PSA_4", "PSA_5",
  "PSA_6", "PSA_7", "PSA_8", "PSA_9", "PSA_10",
  "BGS_9", "BGS_9_5", "BGS_10",
  "CGC_9", "CGC_9_5", "CGC_10",
]);

const patchWatchSchema = z.object({
  targetPence: z.coerce.number().int().positive().optional(),
  active: z.boolean().optional(),
  grade: gradeSchema.optional(),
}).refine((value) => value.targetPence !== undefined || value.active !== undefined || value.grade !== undefined, {
  message: "at least one watch field is required",
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const parsed = patchWatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid watch update",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const watch = await getPrisma().watch.update({
      where: { id: params.id },
      data: {
        ...(parsed.data.targetPence !== undefined ? { targetPence: parsed.data.targetPence } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        ...(parsed.data.grade !== undefined ? { grade: parsed.data.grade as Grade } : {}),
      },
      include: {
        card: true,
        alerts: { orderBy: { firedAt: "desc" }, take: 1 },
      },
    });
    return NextResponse.json({ watch });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "watch update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const prisma = getPrisma();
    await prisma.$transaction([
      prisma.alert.deleteMany({ where: { watchId: params.id } }),
      prisma.watch.delete({ where: { id: params.id } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "watch delete failed" },
      { status: 500 },
    );
  }
}
