import type { Grade } from "../domain/types.js";

export type CardPriceHistory = {
  card: {
    id: string;
    name: string;
    setName: string;
    number: string | null;
    imageUrl: string | null;
    displayImageUrl: string | null;
  };
  grade: Grade;
  range: { from: string; to: string };
  snapshots: Array<{ takenAt: string; marketPence: number }>;
  comps: Array<{
    id: string;
    asOf: string;
    createdAt: string;
    medianPence: number;
    source: string;
    sampleSize: number;
    windowDays: number;
    confidence: string | null;
    manualCheck: boolean;
  }>;
  inventory: Array<{ id: string; acquiredAt: string; costBasis: number }>;
  listings: Array<{
    itemId: string;
    id: string;
    createdAt: string;
    updatedAt: string;
    suggestedPrice: number | null;
    listPrice: number | null;
    state: string;
    channel: string;
  }>;
  sales: Array<{ itemId: string; soldAt: string; salePrice: number; fees: number; postage: number }>;
};

export const GENUINE_SOLD_COMP_SOURCES = [
  "owned-sales",
  "checked-comps",
  "pokemon-price-tracker",
  "ebay-marketplace-insights",
] as const;

export type GenuineSoldCompSource = (typeof GENUINE_SOLD_COMP_SOURCES)[number];

export type GenuineSoldCompEvidence = {
  source: GenuineSoldCompSource;
  medianPence: number;
  sampleSize: number;
  windowDays: number;
  asOf: string;
  sourceRegion?: string;
};

export type CardPriceHistoryPreview = {
  key: string;
  cardId: string;
  grade: Grade;
  range: { from: string; to: string };
  market: Array<{ takenAt: string; marketPence: number }>;
  soldEvidence: GenuineSoldCompEvidence | null;
};

type PreviewCompRow = {
  cardId: string;
  grade: Grade;
  source: string;
  medianPence: number;
  sampleSize: number;
  windowDays: number;
  asOf: Date;
  createdAt: Date;
  manualCheck: boolean;
  receipt: unknown | null;
};

export type PriceHistoryPreviewDb = {
  priceSnapshot: {
    findMany(args: unknown): Promise<Array<{
      cardId: string;
      grade: Grade;
      takenAt: Date;
      marketPence: number;
    }>>;
  };
  compResult: { findMany(args: unknown): Promise<PreviewCompRow[]> };
};

const PREVIEW_POINT_LIMIT = 16;

export function cardGradeHistoryKey(cardId: string, grade: string): string {
  return `${cardId}|${grade}`;
}

export function isGenuineSoldCompSource(source: string): source is GenuineSoldCompSource {
  return (GENUINE_SOLD_COMP_SOURCES as readonly string[]).includes(source);
}

/**
 * Load all Stock sparkline points and latest sold receipts in two queries total.
 * Snapshot/headline rows may power the internal trend line, but only explicitly
 * allow-listed sold adapters can become buyer-facing evidence.
 */
export async function readCardPriceHistoryPreviews(
  db: PriceHistoryPreviewDb,
  refs: Array<{ cardId: string; grade: Grade }>,
  input: { days?: number; now?: Date } = {},
): Promise<CardPriceHistoryPreview[]> {
  const uniqueRefs = dedupeHistoryRefs(refs);
  if (uniqueRefs.length === 0) return [];

  const now = input.now ?? new Date();
  const days = Math.max(1, Math.min(3_650, Math.round(input.days ?? 365)));
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
  const pairWhere = uniqueRefs.map((ref) => ({ cardId: ref.cardId, grade: ref.grade }));
  const [snapshots, comps] = await Promise.all([
    db.priceSnapshot.findMany({
      where: { OR: pairWhere, takenAt: { gte: from, lte: now } },
      orderBy: [{ takenAt: "asc" }],
      select: { cardId: true, grade: true, takenAt: true, marketPence: true },
    }),
    db.compResult.findMany({
      where: { OR: pairWhere, asOf: { gte: from, lte: now } },
      orderBy: [{ asOf: "asc" }, { createdAt: "asc" }],
      select: {
        cardId: true,
        grade: true,
        source: true,
        medianPence: true,
        sampleSize: true,
        windowDays: true,
        asOf: true,
        createdAt: true,
        manualCheck: true,
        receipt: true,
      },
    }),
  ]);

  const snapshotsByKey = new Map<string, CardPriceHistoryPreview["market"]>();
  for (const row of snapshots) {
    if (!validMarketPence(row.marketPence)) continue;
    const key = cardGradeHistoryKey(row.cardId, row.grade);
    const bucket = snapshotsByKey.get(key) ?? [];
    bucket.push({ takenAt: row.takenAt.toISOString(), marketPence: Math.round(row.marketPence) });
    snapshotsByKey.set(key, bucket);
  }

  const compsByKey = new Map<string, PreviewCompRow[]>();
  for (const row of comps) {
    const key = cardGradeHistoryKey(row.cardId, row.grade);
    const bucket = compsByKey.get(key) ?? [];
    bucket.push(row);
    compsByKey.set(key, bucket);
  }

  return uniqueRefs.map((ref) => {
    const key = cardGradeHistoryKey(ref.cardId, ref.grade);
    const rows = compsByKey.get(key) ?? [];
    const snapshotMarket = snapshotsByKey.get(key) ?? [];
    const compMarket = rows
      .filter((row) => validMarketPence(row.medianPence))
      .map((row) => ({ takenAt: row.asOf.toISOString(), marketPence: Math.round(row.medianPence) }));
    return {
      key,
      cardId: ref.cardId,
      grade: ref.grade,
      range: { from: from.toISOString(), to: now.toISOString() },
      market: downsampleMarketPoints(snapshotMarket.length > 0 ? snapshotMarket : compMarket),
      soldEvidence: latestGenuineSoldEvidence(rows),
    };
  });
}

function dedupeHistoryRefs(refs: Array<{ cardId: string; grade: Grade }>): Array<{ cardId: string; grade: Grade }> {
  const byKey = new Map<string, { cardId: string; grade: Grade }>();
  for (const ref of refs) {
    const cardId = ref.cardId.trim();
    if (!cardId) continue;
    byKey.set(cardGradeHistoryKey(cardId, ref.grade), { cardId, grade: ref.grade });
  }
  return [...byKey.values()];
}

function downsampleMarketPoints(points: CardPriceHistoryPreview["market"]): CardPriceHistoryPreview["market"] {
  if (points.length <= PREVIEW_POINT_LIMIT) return points;
  const sampled = Array.from({ length: PREVIEW_POINT_LIMIT }, (_, index) => {
    const sourceIndex = Math.round((index * (points.length - 1)) / (PREVIEW_POINT_LIMIT - 1));
    return points[sourceIndex]!;
  });
  return sampled.filter((point, index) => index === 0 || point.takenAt !== sampled[index - 1]?.takenAt);
}

function latestGenuineSoldEvidence(rows: PreviewCompRow[]): GenuineSoldCompEvidence | null {
  const candidates: Array<GenuineSoldCompEvidence & { persistedAt: number }> = [];
  for (const row of rows) {
    // A reconciler receipt marked for manual checking is useful internally but
    // should not become a factual sold-price claim in buyer-facing copy.
    if (row.manualCheck) continue;
    const direct = parseSoldEvidenceCandidate(row, row.createdAt.getTime());
    if (direct) candidates.push(direct);

    const receipt = asRecord(row.receipt);
    const all = Array.isArray(receipt?.all) ? receipt.all : [];
    for (const value of all) {
      const candidate = asRecord(value);
      if (!candidate) continue;
      if (typeof candidate.grade === "string" && candidate.grade !== row.grade) continue;
      const parsed = parseSoldEvidenceCandidate(candidate, row.createdAt.getTime());
      if (parsed) candidates.push(parsed);
    }
  }
  return candidates
    .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf) || b.persistedAt - a.persistedAt)
    .map(({ persistedAt: _persistedAt, ...candidate }) => candidate)[0] ?? null;
}

function parseSoldEvidenceCandidate(
  value: Record<string, unknown> | PreviewCompRow,
  persistedAt: number,
): (GenuineSoldCompEvidence & { persistedAt: number }) | null {
  const source = typeof value.source === "string" ? value.source : "";
  if (!isGenuineSoldCompSource(source)) return null;
  const medianPence = Number(value.medianPence);
  const sampleSize = Number(value.sampleSize);
  const windowDays = Number(value.windowDays);
  const date = value.asOf instanceof Date ? value.asOf : new Date(String(value.asOf ?? ""));
  if (!validMarketPence(medianPence)) return null;
  if (!Number.isInteger(sampleSize) || sampleSize <= 0) return null;
  if (!Number.isInteger(windowDays) || windowDays <= 0 || windowDays > 3_650) return null;
  if (!Number.isFinite(date.getTime())) return null;

  const raw = asRecord((value as { raw?: unknown }).raw);
  const rawRegion = typeof raw?.region === "string" ? raw.region.trim().toUpperCase() : "";
  const sourceRegion = rawRegion === "UK" || rawRegion === "EU" || rawRegion === "US"
    ? rawRegion
    : source === "owned-sales" || source === "ebay-marketplace-insights"
      ? "UK"
      : undefined;
  return {
    source,
    medianPence: Math.round(medianPence),
    sampleSize,
    windowDays,
    asOf: date.toISOString(),
    ...(sourceRegion ? { sourceRegion } : {}),
    persistedAt,
  };
}

function validMarketPence(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export type PriceHistoryDb = {
  card: { findUnique(args: unknown): Promise<CardPriceHistory["card"] | null> };
  priceSnapshot: { findMany(args: unknown): Promise<Array<{ takenAt: Date; marketPence: number }>> };
  compResult: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      asOf: Date;
      createdAt: Date;
      medianPence: number;
      source: string;
      sampleSize: number;
      windowDays: number;
      confidence: string | null;
      manualCheck: boolean;
    }>>;
  };
  inventoryItem: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      acquiredAt: Date;
      costBasis: number;
      listings: Array<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        suggestedPrice: number | null;
        listPrice: number | null;
        state: string;
        channel: string;
      }>;
      sales: Array<{ soldAt: Date; salePrice: number; fees: number; postage: number }>;
    }>>;
  };
};

export async function readCardPriceHistory(
  db: PriceHistoryDb,
  input: { cardId: string; grade: Grade; days?: number; now?: Date },
): Promise<CardPriceHistory | null> {
  const now = input.now ?? new Date();
  const days = Math.max(1, Math.min(3_650, Math.round(input.days ?? 365)));
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
  const card = await db.card.findUnique({ where: { id: input.cardId } });
  if (!card) return null;
  const [snapshots, comps, items] = await Promise.all([
    db.priceSnapshot.findMany({
      where: { cardId: input.cardId, grade: input.grade, takenAt: { gte: from, lte: now } },
      orderBy: { takenAt: "asc" },
      select: { takenAt: true, marketPence: true },
    }),
    db.compResult.findMany({
      where: { cardId: input.cardId, grade: input.grade, asOf: { gte: from, lte: now } },
      orderBy: { asOf: "asc" },
      select: {
        id: true,
        asOf: true,
        createdAt: true,
        medianPence: true,
        source: true,
        sampleSize: true,
        windowDays: true,
        confidence: true,
        manualCheck: true,
      },
    }),
    db.inventoryItem.findMany({
      where: { cardId: input.cardId, grade: input.grade },
      select: {
        id: true,
        acquiredAt: true,
        costBasis: true,
        listings: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            createdAt: true,
            updatedAt: true,
            suggestedPrice: true,
            listPrice: true,
            state: true,
            channel: true,
          },
        },
        sales: {
          where: { soldAt: { gte: from, lte: now } },
          orderBy: { soldAt: "asc" },
          select: { soldAt: true, salePrice: true, fees: true, postage: true },
        },
      },
      orderBy: { acquiredAt: "asc" },
    }),
  ]);
  return {
    card,
    grade: input.grade,
    range: { from: from.toISOString(), to: now.toISOString() },
    snapshots: snapshots.map((row) => ({ takenAt: row.takenAt.toISOString(), marketPence: row.marketPence })),
    comps: comps.map((row) => ({ ...row, asOf: row.asOf.toISOString(), createdAt: row.createdAt.toISOString() })),
    inventory: items.map((row) => ({ id: row.id, acquiredAt: row.acquiredAt.toISOString(), costBasis: row.costBasis })),
    listings: items.flatMap((row) => row.listings.map((listing) => ({
      itemId: row.id,
      ...listing,
      createdAt: listing.createdAt.toISOString(),
      updatedAt: listing.updatedAt.toISOString(),
    }))),
    sales: items.flatMap((row) => row.sales.map((sale) => ({
      itemId: row.id,
      soldAt: sale.soldAt.toISOString(),
      salePrice: sale.salePrice,
      fees: sale.fees,
      postage: sale.postage,
    }))),
  };
}
