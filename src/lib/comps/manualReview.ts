import type { Grade } from "../domain/types.js";

export const MANUAL_REVIEW_RESOLUTIONS = [
  "ACCEPT_HEADLINE",
  "CHECKED_COMP_ADDED",
  "DISMISSED",
] as const;

export type ManualReviewResolution = (typeof MANUAL_REVIEW_RESOLUTIONS)[number];
export type ManualReviewStatus = "open" | "resolved" | "all";

export type ManualCompReview = {
  id: string;
  card: {
    id: string;
    name: string;
    setName: string;
    number: string | null;
    imageUrl: string | null;
    displayImageUrl: string | null;
  };
  grade: Grade;
  headlinePence: number;
  source: string;
  sampleSize: number;
  windowDays: number;
  asOf: string;
  confidence: string | null;
  manualCheck: true;
  reasons: string[];
  receipt: unknown | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  resolutionNote: string | null;
};

type ManualReviewRow = {
  id: string;
  card: ManualCompReview["card"];
  grade: Grade;
  medianPence: number;
  source: string;
  sampleSize: number;
  windowDays: number;
  asOf: Date;
  confidence: string | null;
  manualCheck: boolean;
  reasons: unknown;
  receipt: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
  resolutionNote: string | null;
};

export type ManualReviewDb = {
  compResult: {
    findMany(args: unknown): Promise<ManualReviewRow[]>;
    findUnique(args: unknown): Promise<ManualReviewRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export async function listManualCompReviews(
  db: ManualReviewDb,
  options: { status?: ManualReviewStatus; limit?: number; cursor?: string } = {},
): Promise<{ reviews: ManualCompReview[]; nextCursor: string | null }> {
  const status = options.status ?? "open";
  const limit = Math.max(1, Math.min(100, Math.round(options.limit ?? 50)));
  const rows = await db.compResult.findMany({
    where: {
      manualCheck: true,
      ...(status === "open" ? { resolvedAt: null } : status === "resolved" ? { resolvedAt: { not: null } } : {}),
    },
    include: { card: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    reviews: page.map(toManualCompReview),
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
  };
}

export async function resolveManualCompReview(
  db: ManualReviewDb,
  input: { id: string; resolution: ManualReviewResolution; note?: string; now?: Date },
): Promise<
  | { kind: "resolved"; review: ManualCompReview }
  | { kind: "idempotent"; review: ManualCompReview }
  | { kind: "not-found" }
  | { kind: "conflict" }
> {
  const id = input.id.trim();
  if (!id) return { kind: "not-found" };
  const note = input.note?.trim().slice(0, 1_000) || null;
  const now = input.now ?? new Date();
  const updated = await db.compResult.updateMany({
    where: { id, manualCheck: true, resolvedAt: null },
    data: { resolvedAt: now, resolution: input.resolution, resolutionNote: note },
  });
  const row = await db.compResult.findUnique({ where: { id }, include: { card: true } });
  if (!row || !row.manualCheck) return { kind: "not-found" };
  if (updated.count === 1) return { kind: "resolved", review: toManualCompReview(row) };
  if (row.resolution === input.resolution && (row.resolutionNote ?? null) === note) {
    return { kind: "idempotent", review: toManualCompReview(row) };
  }
  return { kind: "conflict" };
}

export function isManualReviewResolution(value: unknown): value is ManualReviewResolution {
  return typeof value === "string" && MANUAL_REVIEW_RESOLUTIONS.includes(value as ManualReviewResolution);
}

function toManualCompReview(row: ManualReviewRow): ManualCompReview {
  return {
    id: row.id,
    card: row.card,
    grade: row.grade,
    headlinePence: row.medianPence,
    source: row.source,
    sampleSize: row.sampleSize,
    windowDays: row.windowDays,
    asOf: row.asOf.toISOString(),
    confidence: row.confidence,
    manualCheck: true,
    reasons: Array.isArray(row.reasons) ? row.reasons.filter((item): item is string => typeof item === "string") : [],
    receipt: row.receipt ?? null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolution: row.resolution,
    resolutionNote: row.resolutionNote,
  };
}
