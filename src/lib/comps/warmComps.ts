import type { CardRef, CompResult, Grade } from "../domain/types.js";

export interface WarmCompItem {
  id: string;
  card: CardRef;
  grade: Grade;
}

export interface WarmCompSuccess {
  itemId: string;
  headline: CompResult;
}

export interface WarmCompFailure {
  itemId: string;
  reason: string;
}

export interface WarmCompOptions {
  limit?: number;
  concurrency?: number;
  timeoutMs?: number;
}

export interface WarmCompSummary {
  scanned: number;
  skipped: number;
  refreshed: number;
  failed: number;
  successes: WarmCompSuccess[];
  failures: WarmCompFailure[];
}

const DEFAULT_LIMIT = 100;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 15_000;

export async function warmComps(
  items: WarmCompItem[],
  lookup: (item: WarmCompItem) => Promise<CompResult>,
  options: WarmCompOptions = {},
): Promise<WarmCompSummary> {
  const limit = clampPositiveInt(options.limit, DEFAULT_LIMIT);
  const concurrency = clampPositiveInt(options.concurrency, DEFAULT_CONCURRENCY);
  const timeoutMs = clampPositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const queue = items.slice(0, limit);
  const successes: WarmCompSuccess[] = [];
  const failures: WarmCompFailure[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      if (!item) continue;
      try {
        const headline = await withTimeout(lookup(item), timeoutMs);
        if (headline.sampleSize <= 0 || headline.medianPence <= 0) {
          failures.push({ itemId: item.id, reason: "no priced comp returned" });
          continue;
        }
        successes.push({ itemId: item.id, headline });
      } catch (err) {
        failures.push({ itemId: item.id, reason: err instanceof Error ? err.message : "comp lookup failed" });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

  return {
    scanned: queue.length,
    skipped: Math.max(0, items.length - queue.length),
    refreshed: successes.length,
    failed: failures.length,
    successes,
    failures,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function clampPositiveInt(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value != null && value > 0 ? value : fallback;
}
