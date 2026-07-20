import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import {
  isManualReviewResolution,
  listManualCompReviews,
  resolveManualCompReview,
  requestManualCompReview,
  type ManualReviewDb,
  type ManualReviewStatus,
} from "@/lib/comps/manualReview";
import { PrismaCardCache } from "@/lib/catalog/prismaCardCache";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import { GRADE_VALUES, RAW_CONDITION_VALUES, type CardRef, type Grade } from "@/lib/domain/types";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PATCH_BODY_BYTES = 4 * 1024;
const requestSchema = z.object({
  card: z.object({
    name: z.string().min(1),
    setName: z.string().optional(),
    number: z.string().optional(),
    tcgApiId: z.string().optional(),
    tcgDexId: z.string().optional(),
  }),
  grade: z.enum(GRADE_VALUES),
  condition: z.enum(RAW_CONDITION_VALUES).optional(),
}).superRefine((data, ctx) => {
  if (data.grade === "RAW" && !data.condition) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["condition"], message: "RAW reviews need an exact condition." });
  }
});

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawStatus = params.get("status")?.trim().toLowerCase();
  const status: ManualReviewStatus = rawStatus === "resolved" || rawStatus === "all" ? rawStatus : "open";
  const limit = Number(params.get("limit") ?? 50);
  const cursor = params.get("cursor")?.trim() || undefined;
  try {
    const result = await listManualCompReviews(getPrisma() as unknown as ManualReviewDb, {
      status,
      limit: Number.isFinite(limit) ? limit : 50,
      cursor,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (isMissingWorkflowMigration(error)) {
      return NextResponse.json({ reviews: [], nextCursor: null, migrationPending: true });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "card and grade are required." }, { status: 400 });
  try {
    const prisma = getPrisma();
    const cache = new PrismaCardCache(prisma, new PokemonTcgApiCatalogSource());
    const card = await cache.resolve({ ...parsed.data.card, game: "POKEMON", language: "EN" } as CardRef);
    const result = await requestManualCompReview(prisma as unknown as ManualReviewDb, {
      cardId: card.id,
      grade: parsed.data.grade as Grade,
      condition: parsed.data.condition,
    });
    if (result.kind === "not-found") {
      return NextResponse.json({ error: "Run an automatic comp before saving a review task." }, { status: 404 });
    }
    return NextResponse.json({ review: result.review }, { status: 201 });
  } catch (error) {
    if (isMissingWorkflowMigration(error)) {
      return NextResponse.json({ error: "Review tasks are temporarily unavailable while the workflow upgrade finishes." }, { status: 503 });
    }
    throw error;
  }
}

function isMissingWorkflowMigration(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2022");
}

export async function PATCH(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PATCH_BODY_BYTES) {
    return NextResponse.json({ error: "Review update body is too large." }, { status: 413 });
  }
  let body: { id?: unknown; resolution?: unknown; note?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id || !isManualReviewResolution(body.resolution)) {
    return NextResponse.json({ error: "id and a valid resolution are required." }, { status: 400 });
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    return NextResponse.json({ error: "note must be text." }, { status: 400 });
  }
  const result = await resolveManualCompReview(getPrisma() as unknown as ManualReviewDb, {
    id,
    resolution: body.resolution,
    note: body.note,
  });
  if (result.kind === "not-found") return NextResponse.json({ error: "Review not found." }, { status: 404 });
  if (result.kind === "conflict") return NextResponse.json({ error: "Review was already resolved differently." }, { status: 409 });
  return NextResponse.json({ review: result.review, idempotent: result.kind === "idempotent" });
}
