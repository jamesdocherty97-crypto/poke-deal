import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { GRADE_VALUES } from "@/lib/domain/types";
import { readBoundedJson } from "@/lib/http/boundedJson";
import { readClientMutationId } from "@/lib/offline/clientMutation";
import { appendScanCorrection, type ScanCorrectionDb } from "@/lib/scan/scanCorrection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const correctionSchema = z.object({
  scanEventId: z.string().trim().min(1),
  correction: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    setName: z.string().trim().min(1).max(200).optional(),
    setCode: z.string().trim().min(1).max(50).optional(),
    number: z.string().trim().min(1).max(80).optional(),
    language: z.enum(["EN", "JP"]).optional(),
    edition: z.enum(["UNLIMITED", "FIRST_EDITION", "SHADOWLESS", "STAFF", "PRERELEASE"]).optional(),
    finish: z.enum(["NORMAL", "HOLO", "REVERSE_HOLO"]).optional(),
    tcgApiId: z.string().trim().min(1).max(100).optional(),
    tcgDexId: z.string().trim().min(1).max(100).optional(),
    cardmarketId: z.string().trim().min(1).max(100).optional(),
    grade: z.enum(GRADE_VALUES).optional(),
    condition: z.string().trim().min(1).max(100).optional(),
  }).refine((value) => Object.values(value).some((item) => item !== undefined), "At least one corrected field is required."),
  note: z.string().trim().min(1).max(500).optional(),
});

export async function POST(request: Request) {
  const mutation = readClientMutationId(request);
  if (!mutation.ok) return NextResponse.json({ error: mutation.error }, { status: 400 });
  const bounded = await readBoundedJson<unknown>(request, 8 * 1024);
  if (!bounded.ok) return NextResponse.json({ error: bounded.error }, { status: bounded.status });
  const parsed = correctionSchema.safeParse(bounded.value);
  if (!parsed.success) {
    return NextResponse.json({
      error: "Invalid scan correction.",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, { status: 400 });
  }
  const result = await appendScanCorrection(getPrisma() as unknown as ScanCorrectionDb, {
    scanEventId: parsed.data.scanEventId,
    correctionKey: mutation.value ?? `correction:${randomUUID()}`,
    ...parsed.data.correction,
    note: parsed.data.note,
  });
  if (result.kind === "not-found") {
    return NextResponse.json({ error: "Original scan event not found." }, { status: 404 });
  }
  return NextResponse.json({
    correction: result.correction,
    idempotent: result.kind === "idempotent",
  }, { status: result.kind === "created" ? 201 : 200 });
}
