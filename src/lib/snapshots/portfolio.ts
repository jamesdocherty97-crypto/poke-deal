export type PortfolioHolding = {
  cardId: string;
  grade: string;
  quantity: number;
};

export type PortfolioSnapshotRow = {
  cardId: string;
  grade: string;
  marketPence: number;
  takenAt: Date | string;
};

export type PortfolioPoint = {
  date: string;
  marketValuePence: number;
  snapshotCount: number;
};

export type PortfolioHistorySummary = {
  points: PortfolioPoint[];
  latest: PortfolioPoint | null;
  previous: PortfolioPoint | null;
  changePence: number | null;
  changePct: number | null;
};

export function summarizePortfolioHistory(
  holdings: PortfolioHolding[],
  snapshots: PortfolioSnapshotRow[],
): PortfolioHistorySummary {
  const quantities = new Map<string, number>();
  for (const holding of holdings) {
    if (holding.quantity <= 0) continue;
    const key = snapshotKey(holding.cardId, holding.grade);
    quantities.set(key, (quantities.get(key) ?? 0) + holding.quantity);
  }

  const byDate = new Map<string, { marketValuePence: number; snapshotCount: number }>();
  for (const snapshot of snapshots) {
    const quantity = quantities.get(snapshotKey(snapshot.cardId, snapshot.grade));
    if (!quantity || snapshot.marketPence <= 0) continue;
    const date = snapshotDateKey(snapshot.takenAt);
    const current = byDate.get(date) ?? { marketValuePence: 0, snapshotCount: 0 };
    current.marketValuePence += snapshot.marketPence * quantity;
    current.snapshotCount += 1;
    byDate.set(date, current);
  }

  const points = [...byDate.entries()]
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = points.at(-1) ?? null;
  const previous = points.at(-2) ?? null;
  const changePence = latest && previous ? latest.marketValuePence - previous.marketValuePence : null;
  const changePct =
    latest && previous && previous.marketValuePence > 0
      ? Math.round((changePence! / previous.marketValuePence) * 1000) / 10
      : null;

  return { points, latest, previous, changePence, changePct };
}

export function snapshotDate(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function snapshotDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
}

export function snapshotKey(cardId: string, grade: string): string {
  return `${cardId}::${grade}`;
}
