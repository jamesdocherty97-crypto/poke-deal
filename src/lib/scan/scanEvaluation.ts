export type ScanEvaluationRow = {
  id: string;
  source: string;
  status: string;
  model: string | null;
  latencyMs: number | null;
  correctionOfId: string | null;
  createdAt: Date;
};

export type ScanEvaluationSummary = {
  periodDays: number;
  total: number;
  readable: number;
  unreadable: number;
  errors: number;
  corrected: number;
  readableRatePct: number | null;
  correctionRatePct: number | null;
  latencyMs: { p50: number | null; p95: number | null };
  models: Array<{ model: string; scans: number; readableRatePct: number | null; correctionRatePct: number | null }>;
  measuredAt: string;
};

export type ScanEvaluationDb = {
  scanEvent: { findMany(args: unknown): Promise<ScanEvaluationRow[]> };
};

export async function readScanEvaluation(
  db: ScanEvaluationDb,
  options: { days?: number; limit?: number; now?: Date } = {},
): Promise<ScanEvaluationSummary> {
  const now = options.now ?? new Date();
  const periodDays = clampInteger(options.days ?? 30, 1, 365);
  const limit = clampInteger(options.limit ?? 2_000, 1, 10_000);
  const rows = await db.scanEvent.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - periodDays * 86_400_000), lte: now } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      source: true,
      status: true,
      model: true,
      latencyMs: true,
      correctionOfId: true,
      createdAt: true,
    },
  });
  return evaluateScanEvents(rows, { periodDays, now });
}

export function evaluateScanEvents(
  rows: ScanEvaluationRow[],
  options: { periodDays?: number; now?: Date } = {},
): ScanEvaluationSummary {
  const originals = rows.filter((row) => !row.correctionOfId && row.source !== "dealer-correction");
  const corrections = rows.filter((row) => Boolean(row.correctionOfId) || row.status === "CORRECTED");
  const correctedOriginalIds = new Set(corrections.map((row) => row.correctionOfId).filter((id): id is string => Boolean(id)));
  const readableIds = new Set(originals.filter((row) => row.status === "READABLE").map((row) => row.id));
  const readable = readableIds.size;
  const unreadable = originals.filter((row) => row.status === "UNREADABLE").length;
  const errors = originals.filter((row) => row.status === "ERROR").length;
  const completed = readable + unreadable;
  const latencies = originals
    .map((row) => row.latencyMs)
    .filter((value): value is number => Number.isFinite(value) && Number(value) >= 0)
    .sort((a, b) => a - b);
  const modelNames = [...new Set(originals.map((row) => row.model?.trim() || "unknown"))].sort();

  return {
    periodDays: clampInteger(options.periodDays ?? 30, 1, 365),
    total: originals.length,
    readable,
    unreadable,
    errors,
    corrected: correctedOriginalIds.size,
    readableRatePct: completed > 0 ? percentage(readable, completed) : null,
    correctionRatePct: readable > 0
      ? percentage([...correctedOriginalIds].filter((id) => readableIds.has(id)).length, readable)
      : null,
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    models: modelNames.map((model) => {
      const modelRows = originals.filter((row) => (row.model?.trim() || "unknown") === model);
      const modelReadable = modelRows.filter((row) => row.status === "READABLE").length;
      const modelUnreadable = modelRows.filter((row) => row.status === "UNREADABLE").length;
      const modelReadableIds = new Set(modelRows.filter((row) => row.status === "READABLE").map((row) => row.id));
      const modelCorrected = [...correctedOriginalIds].filter((id) => modelReadableIds.has(id)).length;
      return {
        model,
        scans: modelRows.length,
        readableRatePct: modelReadable + modelUnreadable > 0 ? percentage(modelReadable, modelReadable + modelUnreadable) : null,
        correctionRatePct: modelReadable > 0 ? percentage(modelCorrected, modelReadable) : null,
      };
    }),
    measuredAt: (options.now ?? new Date()).toISOString(),
  };
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  return Math.round(values[Math.ceil(values.length * fraction) - 1]!);
}

function percentage(part: number, total: number): number {
  return Math.round((part / total) * 1_000) / 10;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
