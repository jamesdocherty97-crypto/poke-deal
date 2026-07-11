import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import {
  isManualReviewResolution,
  listManualCompReviews,
  resolveManualCompReview,
  type ManualReviewDb,
  type ManualReviewStatus,
} from "@/lib/comps/manualReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PATCH_BODY_BYTES = 4 * 1024;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawStatus = params.get("status")?.trim().toLowerCase();
  const status: ManualReviewStatus = rawStatus === "resolved" || rawStatus === "all" ? rawStatus : "open";
  const limit = Number(params.get("limit") ?? 50);
  const cursor = params.get("cursor")?.trim() || undefined;
  const result = await listManualCompReviews(getPrisma() as unknown as ManualReviewDb, {
    status,
    limit: Number.isFinite(limit) ? limit : 50,
    cursor,
  });
  return NextResponse.json(result);
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
