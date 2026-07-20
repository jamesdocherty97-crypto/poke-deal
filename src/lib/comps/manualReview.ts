import type { Grade, RawCondition } from "../domain/types.js";

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
  condition: RawCondition | null;
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
  reviewRequestedAt: string | null;
  reviewExpiresAt: string | null;
};

type ManualReviewRow = {
  id: string;
  card: ManualCompReview["card"];
  grade: Grade;
  condition: string | null;
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
  reviewRequestedAt: Date | null;
  reviewExpiresAt: Date | null;
};

export type ManualReviewDb = {
  compResult: {
    findMany(args: unknown): Promise<ManualReviewRow[]>;
    findFirst(args: unknown): Promise<ManualReviewRow | null>;
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
  const now = new Date();
  const rows = await db.compResult.findMany({
    where: {
      manualCheck: true,
      reviewRequestedAt: { not: null },
      ...(status === "open"
        ? { resolvedAt: null, OR: [{ reviewExpiresAt: null }, { reviewExpiresAt: { gt: now } }] }
        : status === "resolved" ? { resolvedAt: { not: null } } : {}),
    },
    include: { card: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(401, (limit + 1) * 4),
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const deduped = rows.filter((row, index, all) =>
    all.findIndex((candidate) =>
      candidate.card.id === row.card.id && candidate.grade === row.grade && candidate.condition === row.condition,
    ) === index,
  );
  const hasMore = deduped.length > limit;
  const page = deduped.slice(0, limit);
  return {
    reviews: page.map(toManualCompReview),
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
  };
}

export async function requestManualCompReview(
  db: ManualReviewDb,
  input: { cardId: string; grade: Grade; condition?: RawCondition; now?: Date; ttlDays?: number },
): Promise<{ kind: "requested"; review: ManualCompReview } | { kind: "not-found" }> {
  const row = await db.compResult.findFirst({
    where: { cardId: input.cardId, grade: input.grade, condition: input.condition ?? null },
    include: { card: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!row) return { kind: "not-found" };
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + Math.max(1, input.ttlDays ?? 30) * 24 * 60 * 60 * 1_000);
  await db.compResult.updateMany({
    where: {
      cardId: input.cardId,
      grade: input.grade,
      condition: input.condition ?? null,
      reviewRequestedAt: { not: null },
      resolvedAt: null,
    },
    data: {
      resolvedAt: now,
      resolution: "DISMISSED",
      resolutionNote: "Superseded by a newer review request.",
    },
  });
  await db.compResult.updateMany({
    where: { id: row.id },
    data: {
      manualCheck: true,
      reviewRequestedAt: now,
      reviewExpiresAt: expiresAt,
      resolvedAt: null,
      resolution: null,
      resolutionNote: null,
    },
  });
  const requested = await db.compResult.findUnique({ where: { id: row.id }, include: { card: true } });
  return requested ? { kind: "requested", review: toManualCompReview(requested) } : { kind: "not-found" };
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
    condition: normalizeReviewCondition(row.condition),
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
    reviewRequestedAt: row.reviewRequestedAt?.toISOString() ?? null,
    reviewExpiresAt: row.reviewExpiresAt?.toISOString() ?? null,
  };
}

function normalizeReviewCondition(value: string | null | undefined): RawCondition | null {
  return ["NM", "LP", "MP", "HP", "DMG"].includes(value ?? "") ? value as RawCondition : null;
}
