import { GRADE_VALUES, type Grade } from "../domain/types.js";

export type PriceHistoryMarket = "UK" | "EU" | "US" | "GLOBAL";
export type PriceHistoryEvidenceStatus = "priced" | "unavailable";
export type PriceHistoryMetricStatus = "available" | "insufficient";

export type PriceHistoryEvidencePoint = {
  id: string;
  persistedCompId: string;
  role: "headline" | "supporting";
  provider: string;
  market: PriceHistoryMarket | null;
  grade: Grade;
  /** Currency of medianPence. Provider-native currency may still be retained in the stored raw receipt. */
  currency: string;
  medianPence: number | null;
  sampleSize: number;
  windowDays: number;
  asOf: string;
  recordedAt: string;
  confidence: string | null;
  manualCheck: boolean;
  status: PriceHistoryEvidenceStatus;
  reason: string | null;
};

export type PriceHistoryMetricReason =
  | "no-sold-evidence"
  | "stale-evidence"
  | "minimum-sample"
  | "invalid-window"
  | "minimum-observations"
  | "minimum-span"
  | "minimum-sources";

export type PriceHistoryLiquidityMetric = {
  status: PriceHistoryMetricStatus;
  reason: PriceHistoryMetricReason | null;
  salesPer30Days: number | null;
  provider: string | null;
  market: PriceHistoryMarket | null;
  grade: Grade;
  currency: string | null;
  sampleSize: number;
  windowDays: number;
  asOf: string | null;
  ageDays: number | null;
};

export type PriceHistoryVolatilityMetric = {
  status: PriceHistoryMetricStatus;
  reason: PriceHistoryMetricReason | null;
  medianPence: number | null;
  madPence: number | null;
  madPct: number | null;
  observationCount: number;
  minimumSampleSize: number;
  provider: string | null;
  market: PriceHistoryMarket | null;
  grade: Grade;
  currency: string | null;
  from: string | null;
  to: string | null;
  latestAgeDays: number | null;
};

export type PriceHistoryTrendMetric = {
  status: PriceHistoryMetricStatus;
  reason: PriceHistoryMetricReason | null;
  windowDays: 30 | 90;
  changePct: number | null;
  fromPence: number | null;
  toPence: number | null;
  observationCount: number;
  provider: string | null;
  market: PriceHistoryMarket | null;
  grade: Grade;
  currency: string | null;
  from: string | null;
  to: string | null;
  latestAgeDays: number | null;
};

export type PriceHistoryDisagreementPoint = Pick<
  PriceHistoryEvidencePoint,
  "id" | "provider" | "market" | "grade" | "currency" | "medianPence" | "sampleSize" | "asOf"
>;

export type PriceHistoryDisagreementMetric = {
  status: PriceHistoryMetricStatus;
  reason: PriceHistoryMetricReason | null;
  spreadPct: number | null;
  lowPence: number | null;
  highPence: number | null;
  sourceCount: number;
  asOf: string | null;
  evidence: PriceHistoryDisagreementPoint[];
};

export type PriceHistoryProviderAvailability = {
  provider: string;
  status: PriceHistoryEvidenceStatus;
  reason: string | null;
  asOf: string;
};

export type PriceHistoryReceipt = {
  generatedAt: string;
  policy: {
    metricLookbackDays: number;
    maxEvidenceAgeDays: number;
    minSoldSampleSize: number;
    minVolatilityObservations: number;
    minVolatilitySpanDays: number;
    minTrendSpanDays: number;
    disagreementCohortDays: number;
    maxEvidencePoints: number;
  };
  evidence: PriceHistoryEvidencePoint[];
  evidenceTruncated: boolean;
  providerAvailability: PriceHistoryProviderAvailability[];
  metrics: {
    liquidity: PriceHistoryLiquidityMetric;
    volatility: PriceHistoryVolatilityMetric;
    trend30Days: PriceHistoryTrendMetric;
    trend90Days: PriceHistoryTrendMetric;
    sourceDisagreement: PriceHistoryDisagreementMetric;
  };
};

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
  /** Additive, provenance-rich metrics. Optional keeps older cached client payloads readable. */
  receipt?: PriceHistoryReceipt;
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
const METRIC_LOOKBACK_DAYS = 90;
const MAX_EVIDENCE_AGE_DAYS = 45;
const MIN_SOLD_SAMPLE_SIZE = 3;
const MIN_VOLATILITY_OBSERVATIONS = 4;
const MIN_VOLATILITY_SPAN_DAYS = 14;
const MIN_TREND_SPAN_DAYS = 7;
const DISAGREEMENT_COHORT_DAYS = 14;
const MAX_RECEIPT_EVIDENCE_POINTS = 250;
const DAY_MS = 24 * 60 * 60 * 1_000;

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

type HistoryCompRow = {
  id: string;
  grade?: Grade;
  asOf: Date;
  createdAt: Date;
  medianPence: number;
  source: string;
  sampleSize: number;
  windowDays: number;
  confidence: string | null;
  manualCheck: boolean;
  currency?: string;
  receipt?: unknown | null;
};

export type PriceHistoryDb = {
  card: { findUnique(args: unknown): Promise<CardPriceHistory["card"] | null> };
  priceSnapshot: { findMany(args: unknown): Promise<Array<{ takenAt: Date; marketPence: number }>> };
  compResult: { findMany(args: unknown): Promise<HistoryCompRow[]> };
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
        grade: true,
        asOf: true,
        createdAt: true,
        medianPence: true,
        source: true,
        sampleSize: true,
        windowDays: true,
        confidence: true,
        manualCheck: true,
        currency: true,
        receipt: true,
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
    comps: comps.map((row) => ({
      id: row.id,
      asOf: row.asOf.toISOString(),
      createdAt: row.createdAt.toISOString(),
      medianPence: row.medianPence,
      source: row.source,
      sampleSize: row.sampleSize,
      windowDays: row.windowDays,
      confidence: row.confidence,
      manualCheck: row.manualCheck,
    })),
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
    receipt: buildPriceHistoryReceipt(comps, input.grade, now),
  };
}

function buildPriceHistoryReceipt(rows: readonly HistoryCompRow[], grade: Grade, now: Date): PriceHistoryReceipt {
  const allEvidence = buildPriceHistoryEvidence(rows, grade);
  const evidence = allEvidence.length > MAX_RECEIPT_EVIDENCE_POINTS
    ? allEvidence.slice(-MAX_RECEIPT_EVIDENCE_POINTS)
    : allEvidence;
  return {
    generatedAt: now.toISOString(),
    policy: {
      metricLookbackDays: METRIC_LOOKBACK_DAYS,
      maxEvidenceAgeDays: MAX_EVIDENCE_AGE_DAYS,
      minSoldSampleSize: MIN_SOLD_SAMPLE_SIZE,
      minVolatilityObservations: MIN_VOLATILITY_OBSERVATIONS,
      minVolatilitySpanDays: MIN_VOLATILITY_SPAN_DAYS,
      minTrendSpanDays: MIN_TREND_SPAN_DAYS,
      disagreementCohortDays: DISAGREEMENT_COHORT_DAYS,
      maxEvidencePoints: MAX_RECEIPT_EVIDENCE_POINTS,
    },
    evidence,
    evidenceTruncated: evidence.length < allEvidence.length,
    providerAvailability: latestProviderAvailability(allEvidence),
    metrics: {
      liquidity: liquidityMetric(allEvidence, grade, now),
      volatility: volatilityMetric(allEvidence, grade, now),
      trend30Days: trendMetric(allEvidence, grade, now, 30),
      trend90Days: trendMetric(allEvidence, grade, now, 90),
      sourceDisagreement: disagreementMetric(allEvidence, grade, now),
    },
  };
}

function buildPriceHistoryEvidence(rows: readonly HistoryCompRow[], grade: Grade): PriceHistoryEvidencePoint[] {
  const byEvidenceKey = new Map<string, PriceHistoryEvidencePoint>();
  for (const row of rows) {
    addEvidencePoint(byEvidenceKey, evidencePoint(row, row as unknown as Record<string, unknown>, "headline", 0, grade));
    const receipt = asRecord(row.receipt);
    const supporting = Array.isArray(receipt?.all) ? receipt.all : [];
    supporting.forEach((candidate, index) => {
      const value = asRecord(candidate);
      if (!value) return;
      addEvidencePoint(byEvidenceKey, evidencePoint(row, value, "supporting", index, grade));
    });
  }
  return [...byEvidenceKey.values()].sort((left, right) =>
    Date.parse(left.asOf) - Date.parse(right.asOf) ||
    left.provider.localeCompare(right.provider) ||
    left.role.localeCompare(right.role),
  );
}

function addEvidencePoint(
  byEvidenceKey: Map<string, PriceHistoryEvidencePoint>,
  point: PriceHistoryEvidencePoint,
): void {
  const baseKey = [
    point.provider,
    point.grade,
    point.currency,
    point.asOf,
    point.medianPence ?? "none",
    point.sampleSize,
    point.windowDays,
  ].join("|");
  const key = `${baseKey}|${point.market ?? "unknown"}`;
  const unknownMarketKey = `${baseKey}|unknown`;
  const existingKey = byEvidenceKey.has(key)
    ? key
    : point.market && byEvidenceKey.has(unknownMarketKey)
      ? unknownMarketKey
      : null;
  const existing = existingKey ? byEvidenceKey.get(existingKey) : undefined;
  if (!existing) {
    byEvidenceKey.set(key, point);
    return;
  }
  if (existingKey !== key) byEvidenceKey.delete(existingKey!);
  byEvidenceKey.set(key, {
    ...existing,
    id: existing.role === "headline" ? existing.id : point.id,
    persistedCompId: existing.role === "headline" ? existing.persistedCompId : point.persistedCompId,
    role: existing.role === "headline" || point.role === "headline" ? "headline" : "supporting",
    market: existing.market ?? point.market,
    confidence: existing.confidence ?? point.confidence,
    manualCheck: existing.manualCheck || point.manualCheck,
    status: existing.status === "priced" || point.status === "priced" ? "priced" : "unavailable",
    reason: existing.reason ?? point.reason,
  });
}

function evidencePoint(
  row: HistoryCompRow,
  value: Record<string, unknown>,
  role: PriceHistoryEvidencePoint["role"],
  index: number,
  fallbackGrade: Grade,
): PriceHistoryEvidencePoint {
  const provider = cleanText(value.source) ?? (row.source.trim() || "unknown");
  const sampleSize = nonNegativeInteger(value.sampleSize, row.sampleSize);
  const windowDays = nonNegativeInteger(value.windowDays, row.windowDays);
  const rawMedian = Number(value.medianPence ?? row.medianPence);
  const medianPence = validMarketPence(rawMedian) ? Math.round(rawMedian) : null;
  const status: PriceHistoryEvidenceStatus = medianPence != null && sampleSize > 0 ? "priced" : "unavailable";
  const raw = asRecord(value.raw);
  const asOf = validIso(value.asOf) ?? row.asOf.toISOString();
  return {
    id: `${row.id}:${role}:${index}`,
    persistedCompId: row.id,
    role,
    provider,
    market: evidenceMarket(provider, value, raw),
    grade: evidenceGrade(value.grade, row, fallbackGrade),
    currency: evidenceCurrency(value.currency, row.currency),
    medianPence,
    sampleSize,
    windowDays,
    asOf,
    recordedAt: row.createdAt.toISOString(),
    confidence: cleanText(value.confidence) ?? row.confidence,
    manualCheck: row.manualCheck || value.manualCheck === true,
    status,
    reason: status === "unavailable"
      ? cleanText(raw?.reason) ?? cleanText(value.reason) ?? "Provider returned no priced evidence."
      : null,
  };
}

function evidenceGrade(value: unknown, row: HistoryCompRow, fallback: Grade): Grade {
  if (typeof value === "string" && (GRADE_VALUES as readonly string[]).includes(value)) return value as Grade;
  if (row.grade && (GRADE_VALUES as readonly string[]).includes(row.grade)) return row.grade;
  const receipt = asRecord(row.receipt);
  const receiptGrade = cleanText(receipt?.grade);
  if (receiptGrade && (GRADE_VALUES as readonly string[]).includes(receiptGrade)) return receiptGrade as Grade;
  return fallback;
}

function evidenceCurrency(value: unknown, fallback: string | undefined): string {
  const currency = cleanText(value) ?? cleanText(fallback) ?? "GBP";
  return currency.toUpperCase();
}

function evidenceMarket(
  provider: string,
  value: Record<string, unknown>,
  raw: Record<string, unknown> | null,
): PriceHistoryMarket | null {
  for (const candidate of [value.market, value.sourceRegion, value.region, raw?.market, raw?.sourceRegion, raw?.region]) {
    const market = normalizeMarket(candidate);
    if (market) return market;
  }
  const chosenSignal = asRecord(raw?.chosenSignal);
  const transitiveSource = cleanText(chosenSignal?.source)?.toLowerCase();
  if (transitiveSource === "cardmarket") return "EU";
  if (transitiveSource === "tcgplayer") return "US";

  if (provider === "owned-sales" || provider === "ebay-marketplace-insights") return "UK";
  if (provider === "pokemon-price-tracker") return "US";
  return null;
}

function normalizeMarket(value: unknown): PriceHistoryMarket | null {
  const normalized = cleanText(value)?.toUpperCase().replace(/[^A-Z]/g, "");
  if (!normalized) return null;
  if (["UK", "GB", "GBR", "UNITEDKINGDOM"].includes(normalized)) return "UK";
  if (["EU", "EUR", "EUROPE", "EUROPEANUNION"].includes(normalized)) return "EU";
  if (["US", "USA", "UNITEDSTATES"].includes(normalized)) return "US";
  if (["GLOBAL", "WORLD", "WORLDWIDE", "MIXED"].includes(normalized)) return "GLOBAL";
  return null;
}

function latestProviderAvailability(evidence: readonly PriceHistoryEvidencePoint[]): PriceHistoryProviderAvailability[] {
  const latest = new Map<string, PriceHistoryEvidencePoint>();
  for (const point of evidence) {
    const current = latest.get(point.provider);
    if (!current || Date.parse(point.asOf) > Date.parse(current.asOf) ||
      (point.asOf === current.asOf && point.status === "priced" && current.status === "unavailable")) {
      latest.set(point.provider, point);
    }
  }
  return [...latest.values()]
    .sort((left, right) => left.provider.localeCompare(right.provider))
    .map((point) => ({ provider: point.provider, status: point.status, reason: point.reason, asOf: point.asOf }));
}

function liquidityMetric(
  evidence: readonly PriceHistoryEvidencePoint[],
  grade: Grade,
  now: Date,
): PriceHistoryLiquidityMetric {
  // A rolling aggregate overlaps other providers and earlier receipts. Use one
  // best eligible provider rather than summing samples and overstating velocity.
  const sold = evidence.filter((point) => isSoldMetricEvidence(point, grade));
  const newest = newestEvidence(sold);
  if (!newest) return emptyLiquidityMetric(grade, "no-sold-evidence");

  const fresh = sold.filter((point) => evidenceAgeDays(point, now) <= MAX_EVIDENCE_AGE_DAYS);
  if (fresh.length === 0) return emptyLiquidityMetric(grade, "stale-evidence", newest, now);
  const validWindow = fresh.filter((point) => point.windowDays > 0 && point.windowDays <= 3_650);
  if (validWindow.length === 0) return emptyLiquidityMetric(grade, "invalid-window", newestEvidence(fresh), now);
  const sampled = validWindow.filter((point) => point.sampleSize >= MIN_SOLD_SAMPLE_SIZE);
  if (sampled.length === 0) return emptyLiquidityMetric(grade, "minimum-sample", newestEvidence(validWindow), now);

  const chosen = [...sampled].sort(compareMetricEvidence)[0]!;
  return {
    status: "available",
    reason: null,
    salesPer30Days: round1((chosen.sampleSize / chosen.windowDays) * 30),
    provider: chosen.provider,
    market: chosen.market,
    grade,
    currency: chosen.currency,
    sampleSize: chosen.sampleSize,
    windowDays: chosen.windowDays,
    asOf: chosen.asOf,
    ageDays: round1(evidenceAgeDays(chosen, now)),
  };
}

function emptyLiquidityMetric(
  grade: Grade,
  reason: PriceHistoryMetricReason,
  point?: PriceHistoryEvidencePoint | null,
  now?: Date,
): PriceHistoryLiquidityMetric {
  return {
    status: "insufficient",
    reason,
    salesPer30Days: null,
    provider: point?.provider ?? null,
    market: point?.market ?? null,
    grade,
    currency: point?.currency ?? null,
    sampleSize: point?.sampleSize ?? 0,
    windowDays: point?.windowDays ?? 0,
    asOf: point?.asOf ?? null,
    ageDays: point && now ? round1(evidenceAgeDays(point, now)) : null,
  };
}

type EvidenceSeries = {
  key: string;
  provider: string;
  market: PriceHistoryMarket | null;
  currency: string;
  points: PriceHistoryEvidencePoint[];
};

function volatilityMetric(
  evidence: readonly PriceHistoryEvidencePoint[],
  grade: Grade,
  now: Date,
): PriceHistoryVolatilityMetric {
  // Dispersion is measured within one provider/market series, deduped to one
  // observation per day, so regional disagreement cannot masquerade as volatility.
  const sold = evidence.filter((point) => isSoldMetricEvidence(point, grade));
  if (sold.length === 0) return emptyVolatilityMetric(grade, "no-sold-evidence");
  const validWindow = sold.filter((point) => point.windowDays > 0 && point.windowDays <= 3_650);
  if (validWindow.length === 0) return emptyVolatilityMetric(grade, "invalid-window", seriesFromEvidence(sold));
  const sampled = validWindow.filter((point) => point.sampleSize >= MIN_SOLD_SAMPLE_SIZE);
  if (sampled.length === 0) return emptyVolatilityMetric(grade, "minimum-sample", seriesFromEvidence(validWindow));
  const series = selectMetricSeries(sampled, now);
  if (!series || series.points.length === 0) {
    return emptyVolatilityMetric(grade, evidenceAgeDays(newestEvidence(sampled)!, now) > MAX_EVIDENCE_AGE_DAYS ? "stale-evidence" : "minimum-observations");
  }
  const latest = series.points.at(-1)!;
  if (evidenceAgeDays(latest, now) > MAX_EVIDENCE_AGE_DAYS) return emptyVolatilityMetric(grade, "stale-evidence", series, now);
  if (series.points.length < MIN_VOLATILITY_OBSERVATIONS) return emptyVolatilityMetric(grade, "minimum-observations", series, now);
  const spanDays = evidenceSpanDays(series.points);
  if (spanDays < MIN_VOLATILITY_SPAN_DAYS) return emptyVolatilityMetric(grade, "minimum-span", series, now);

  const prices = series.points.map((point) => point.medianPence!).sort((left, right) => left - right);
  const center = median(prices);
  const deviations = prices.map((price) => Math.abs(price - center)).sort((left, right) => left - right);
  const mad = median(deviations);
  return {
    status: "available",
    reason: null,
    medianPence: Math.round(center),
    madPence: Math.round(mad),
    madPct: round1((mad / center) * 100),
    observationCount: series.points.length,
    minimumSampleSize: Math.min(...series.points.map((point) => point.sampleSize)),
    provider: series.provider,
    market: series.market,
    grade,
    currency: series.currency,
    from: series.points[0]!.asOf,
    to: latest.asOf,
    latestAgeDays: round1(evidenceAgeDays(latest, now)),
  };
}

function emptyVolatilityMetric(
  grade: Grade,
  reason: PriceHistoryMetricReason,
  series?: EvidenceSeries | null,
  now?: Date,
): PriceHistoryVolatilityMetric {
  const points = series?.points ?? [];
  const latest = points.at(-1);
  return {
    status: "insufficient",
    reason,
    medianPence: null,
    madPence: null,
    madPct: null,
    observationCount: points.length,
    minimumSampleSize: points.length > 0 ? Math.min(...points.map((point) => point.sampleSize)) : 0,
    provider: series?.provider ?? null,
    market: series?.market ?? null,
    grade,
    currency: series?.currency ?? null,
    from: points[0]?.asOf ?? null,
    to: latest?.asOf ?? null,
    latestAgeDays: latest && now ? round1(evidenceAgeDays(latest, now)) : null,
  };
}

function trendMetric(
  evidence: readonly PriceHistoryEvidencePoint[],
  grade: Grade,
  now: Date,
  windowDays: 30 | 90,
): PriceHistoryTrendMetric {
  const sold = evidence.filter((point) => isSoldMetricEvidence(point, grade));
  if (sold.length === 0) return emptyTrendMetric(grade, windowDays, "no-sold-evidence");
  const validWindow = sold.filter((point) => point.windowDays > 0 && point.windowDays <= 3_650);
  if (validWindow.length === 0) return emptyTrendMetric(grade, windowDays, "invalid-window", seriesFromEvidence(sold));
  const sampled = validWindow.filter((point) => point.sampleSize >= MIN_SOLD_SAMPLE_SIZE);
  if (sampled.length === 0) return emptyTrendMetric(grade, windowDays, "minimum-sample", seriesFromEvidence(validWindow));
  const series = selectMetricSeries(sampled, now);
  if (!series || series.points.length === 0) return emptyTrendMetric(grade, windowDays, "minimum-observations");
  const latest = series.points.at(-1)!;
  if (evidenceAgeDays(latest, now) > MAX_EVIDENCE_AGE_DAYS) return emptyTrendMetric(grade, windowDays, "stale-evidence", series, now);
  const cutoff = Date.parse(latest.asOf) - windowDays * DAY_MS;
  const points = series.points.filter((point) => Date.parse(point.asOf) >= cutoff);
  const windowSeries = { ...series, points };
  if (points.length < 2) return emptyTrendMetric(grade, windowDays, "minimum-observations", windowSeries, now);
  if (evidenceSpanDays(points) < MIN_TREND_SPAN_DAYS) return emptyTrendMetric(grade, windowDays, "minimum-span", windowSeries, now);
  const first = points[0]!;
  const last = points.at(-1)!;
  return {
    status: "available",
    reason: null,
    windowDays,
    changePct: round1(((last.medianPence! - first.medianPence!) / first.medianPence!) * 100),
    fromPence: first.medianPence,
    toPence: last.medianPence,
    observationCount: points.length,
    provider: series.provider,
    market: series.market,
    grade,
    currency: series.currency,
    from: first.asOf,
    to: last.asOf,
    latestAgeDays: round1(evidenceAgeDays(last, now)),
  };
}

function emptyTrendMetric(
  grade: Grade,
  windowDays: 30 | 90,
  reason: PriceHistoryMetricReason,
  series?: EvidenceSeries | null,
  now?: Date,
): PriceHistoryTrendMetric {
  const points = series?.points ?? [];
  const first = points[0];
  const latest = points.at(-1);
  return {
    status: "insufficient",
    reason,
    windowDays,
    changePct: null,
    fromPence: first?.medianPence ?? null,
    toPence: latest?.medianPence ?? null,
    observationCount: points.length,
    provider: series?.provider ?? null,
    market: series?.market ?? null,
    grade,
    currency: series?.currency ?? null,
    from: first?.asOf ?? null,
    to: latest?.asOf ?? null,
    latestAgeDays: latest && now ? round1(evidenceAgeDays(latest, now)) : null,
  };
}

function disagreementMetric(
  evidence: readonly PriceHistoryEvidencePoint[],
  grade: Grade,
  now: Date,
): PriceHistoryDisagreementMetric {
  // Compare only contemporary GBP evidence. At least one source must carry a
  // real sold sample; two one-point market baselines are not enough for precision.
  const comparable = evidence.filter((point) =>
    point.status === "priced" &&
    point.grade === grade &&
    point.currency === "GBP" &&
    point.sampleSize > 0 &&
    evidenceAgeDays(point, now) <= MAX_EVIDENCE_AGE_DAYS,
  );
  const newest = newestEvidence(comparable);
  if (!newest) return emptyDisagreementMetric("minimum-sources");
  const cohortCutoff = Date.parse(newest.asOf) - DISAGREEMENT_COHORT_DAYS * DAY_MS;
  const latestByProvider = new Map<string, PriceHistoryEvidencePoint>();
  for (const point of comparable.filter((candidate) => Date.parse(candidate.asOf) >= cohortCutoff)) {
    const current = latestByProvider.get(point.provider);
    if (!current || Date.parse(point.asOf) > Date.parse(current.asOf)) latestByProvider.set(point.provider, point);
  }
  const points = [...latestByProvider.values()].sort((left, right) => left.provider.localeCompare(right.provider));
  if (points.length < 2) return emptyDisagreementMetric("minimum-sources", points, newest.asOf);
  const hasRobustSoldBasis = points.some((point) =>
    isGenuineSoldCompSource(point.provider) && point.sampleSize >= MIN_SOLD_SAMPLE_SIZE,
  );
  if (!hasRobustSoldBasis) return emptyDisagreementMetric("minimum-sample", points, newest.asOf);

  const prices = points.map((point) => point.medianPence!).sort((left, right) => left - right);
  const center = median(prices);
  return {
    status: "available",
    reason: null,
    spreadPct: round1(((prices.at(-1)! - prices[0]!) / center) * 100),
    lowPence: prices[0]!,
    highPence: prices.at(-1)!,
    sourceCount: points.length,
    asOf: newest.asOf,
    evidence: points.map(disagreementPoint),
  };
}

function emptyDisagreementMetric(
  reason: PriceHistoryMetricReason,
  points: readonly PriceHistoryEvidencePoint[] = [],
  asOf: string | null = null,
): PriceHistoryDisagreementMetric {
  return {
    status: "insufficient",
    reason,
    spreadPct: null,
    lowPence: null,
    highPence: null,
    sourceCount: new Set(points.map((point) => point.provider)).size,
    asOf,
    evidence: points.map(disagreementPoint),
  };
}

function disagreementPoint(point: PriceHistoryEvidencePoint): PriceHistoryDisagreementPoint {
  return {
    id: point.id,
    provider: point.provider,
    market: point.market,
    grade: point.grade,
    currency: point.currency,
    medianPence: point.medianPence,
    sampleSize: point.sampleSize,
    asOf: point.asOf,
  };
}

function selectMetricSeries(
  evidence: readonly PriceHistoryEvidencePoint[],
  now: Date,
): EvidenceSeries | null {
  const cutoff = now.getTime() - METRIC_LOOKBACK_DAYS * DAY_MS;
  const bySeries = new Map<string, PriceHistoryEvidencePoint[]>();
  for (const point of evidence) {
    const timestamp = Date.parse(point.asOf);
    if (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > now.getTime() + DAY_MS) continue;
    const key = [point.provider, point.market ?? "unknown", point.grade, point.currency].join("|");
    const bucket = bySeries.get(key) ?? [];
    bucket.push(point);
    bySeries.set(key, bucket);
  }
  const series = [...bySeries.entries()].map(([key, points]) => {
    const daily = new Map<string, PriceHistoryEvidencePoint>();
    for (const point of points.sort((left, right) => Date.parse(left.asOf) - Date.parse(right.asOf))) {
      const day = point.asOf.slice(0, 10);
      const current = daily.get(day);
      if (!current || Date.parse(point.asOf) >= Date.parse(current.asOf)) daily.set(day, point);
    }
    const rows = [...daily.values()].sort((left, right) => Date.parse(left.asOf) - Date.parse(right.asOf));
    return {
      key,
      provider: rows[0]?.provider ?? "unknown",
      market: rows[0]?.market ?? null,
      currency: rows[0]?.currency ?? "GBP",
      points: rows,
    } satisfies EvidenceSeries;
  });
  return series.sort((left, right) =>
    Number(seriesIsFresh(right, now)) - Number(seriesIsFresh(left, now)) ||
    right.points.length - left.points.length ||
    evidenceSpanDays(right.points) - evidenceSpanDays(left.points) ||
    metricProviderPriority(right.provider) - metricProviderPriority(left.provider) ||
    Date.parse(right.points.at(-1)?.asOf ?? "") - Date.parse(left.points.at(-1)?.asOf ?? "") ||
    right.key.localeCompare(left.key),
  )[0] ?? null;
}

function seriesIsFresh(series: EvidenceSeries, now: Date): boolean {
  const latest = series.points.at(-1);
  return Boolean(latest && evidenceAgeDays(latest, now) <= MAX_EVIDENCE_AGE_DAYS);
}

function seriesFromEvidence(evidence: readonly PriceHistoryEvidencePoint[]): EvidenceSeries | null {
  const newest = newestEvidence(evidence);
  if (!newest) return null;
  return {
    key: [newest.provider, newest.market ?? "unknown", newest.grade, newest.currency].join("|"),
    provider: newest.provider,
    market: newest.market,
    currency: newest.currency,
    points: [newest],
  };
}

function isSoldMetricEvidence(point: PriceHistoryEvidencePoint, grade: Grade): boolean {
  return point.status === "priced" &&
    !point.manualCheck &&
    point.grade === grade &&
    point.currency === "GBP" &&
    point.medianPence != null &&
    isGenuineSoldCompSource(point.provider);
}

function compareMetricEvidence(left: PriceHistoryEvidencePoint, right: PriceHistoryEvidencePoint): number {
  return Date.parse(right.asOf) - Date.parse(left.asOf) ||
    metricProviderPriority(right.provider) - metricProviderPriority(left.provider) ||
    right.sampleSize - left.sampleSize ||
    left.provider.localeCompare(right.provider);
}

function metricProviderPriority(provider: string): number {
  if (provider === "ebay-marketplace-insights") return 4;
  if (provider === "pokemon-price-tracker") return 3;
  if (provider === "checked-comps") return 2;
  if (provider === "owned-sales") return 1;
  return 0;
}

function newestEvidence(evidence: readonly PriceHistoryEvidencePoint[]): PriceHistoryEvidencePoint | null {
  return [...evidence].sort((left, right) =>
    Date.parse(right.asOf) - Date.parse(left.asOf) || compareMetricEvidence(left, right),
  )[0] ?? null;
}

function evidenceAgeDays(point: PriceHistoryEvidencePoint, now: Date): number {
  const timestamp = Date.parse(point.asOf);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - timestamp) / DAY_MS);
}

function evidenceSpanDays(points: readonly PriceHistoryEvidencePoint[]): number {
  if (points.length < 2) return 0;
  return Math.max(0, (Date.parse(points.at(-1)!.asOf) - Date.parse(points[0]!.asOf)) / DAY_MS);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function validIso(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
