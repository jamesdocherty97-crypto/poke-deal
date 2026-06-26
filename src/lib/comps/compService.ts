// Orchestration: query every configured source, then reconcile to one headline comp.
// Reconciliation rule (v1): prefer the confident result with the largest sample;
// if none are confident, take the largest sample anyway but flag low confidence.
// All individual results are returned too, so the UI can show cross-source spread.

import type { CardRef, CompQuery, CompResult } from "../domain/types.js";
import type { CompSource } from "./CompSource.js";
import { DEFAULT_WINDOW_DAYS, isConfident } from "./cleaning.js";
import { PokemonTcgMarketSource } from "./sources/pokemonTcgMarket.js";
import { PokemonPriceTrackerSource } from "./sources/pokemonPriceTracker.js";
import { PokeTraceSource } from "./sources/pokeTrace.js";

const DEFAULT_SOURCE_TIMEOUT_MS = 8000;

export interface ReconciledComp {
  /** The single comp to act on. */
  headline: CompResult;
  /** Every source's result, for transparency / disagreement display. */
  all: CompResult[];
  /** True when sources disagree materially on the median (>15%). */
  sourcesDisagree: boolean;
}

export class CompService {
  constructor(
    private readonly sources: CompSource[],
    private readonly sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
  ) {}

  /** Default wiring. Add PokeTrace etc. here as adapters are built. */
  static default(): CompService {
    return new CompService([new PokemonPriceTrackerSource(), new PokeTraceSource(), new PokemonTcgMarketSource()]);
  }

  /** Names + live status of configured sources (for diagnostics / UI). */
  get sourceSummaries(): { name: string; live: boolean }[] {
    return this.sources.map((s) => ({ name: s.name, live: s.live }));
  }

  async lookup(card: CardRef, query: CompQuery = {}): Promise<ReconciledComp> {
    const settled = await Promise.allSettled(
      this.sources.map((source) => this.lookupSource(source, card, query)),
    );
    const all = settled
      .filter((r): r is PromiseFulfilledResult<CompResult> => r.status === "fulfilled")
      .map((r) => r.value);

    if (all.length === 0) {
      throw new Error("All comp sources failed");
    }

    const headline = pickHeadline(all);
    return { headline, all, sourcesDisagree: detectDisagreement(all) };
  }

  private async lookupSource(source: CompSource, card: CardRef, query: CompQuery): Promise<CompResult> {
    const fallback = (reason: string): CompResult => emptySourceComp(source.name, card, query, reason);
    try {
      return await withTimeout(
        source.lookup(card, query),
        this.sourceTimeoutMs,
        () => fallback(`${source.name} timed out`),
      );
    } catch (err) {
      return fallback(err instanceof Error ? `${source.name} failed: ${err.message}` : `${source.name} failed`);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: () => T): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback()), timeoutMs);
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

function emptySourceComp(source: string, card: CardRef, query: CompQuery, reason: string): CompResult {
  return {
    source,
    card,
    grade: query.grade ?? "RAW",
    currency: "GBP",
    medianPence: 0,
    meanPence: 0,
    lowPence: 0,
    highPence: 0,
    sampleSize: 0,
    windowDays: query.windowDays ?? DEFAULT_WINDOW_DAYS,
    trendPct: null,
    outliersRemoved: 0,
    asOf: new Date().toISOString(),
    raw: { reason },
  };
}

/** Largest confident sample wins; fall back to largest sample of any. */
export function pickHeadline(results: CompResult[]): CompResult {
  const rawHeadline = pickRawHeadline(results);
  if (rawHeadline) return rawHeadline;

  const confident = results.filter((r) => isConfident(r));
  const pool = confident.length > 0 ? confident : results;
  return pool.reduce((best, r) => (r.sampleSize > best.sampleSize ? r : best));
}

function pickRawHeadline(results: CompResult[]): CompResult | null {
  const rawResults = results.filter((r) => r.grade === "RAW" && r.medianPence > 0);
  if (rawResults.length === 0) return null;

  const smart = rawResults.find((result) => readRawString(result, "chosenPriceSource") === "smartMarketPrice");
  const baselines = rawResults.filter(isRawMarketBaseline);
  const baseline = strongestSignal(baselines);

  if (smart) {
    const baselineConsensus = rawBaselineConsensus(baselines);
    if (baselineConsensus && smartIsHighOutlier(smart, baselineConsensus)) {
      return baselineConsensus.headline;
    }
    return smart;
  }

  if (!baseline) return null;

  const strongestRawBucket = rawResults
    .filter(
      (result) =>
        result.source !== baseline.source && readRawString(result, "chosenPriceSource") !== "smartMarketPrice",
    )
    .reduce<CompResult | null>((best, result) => (!best || result.sampleSize > best.sampleSize ? result : best), null);

  if (!strongestRawBucket) return baseline;
  return detectDisagreement([strongestRawBucket, baseline]) ? baseline : null;
}

function isRawMarketBaseline(result: CompResult): boolean {
  return ["catalog-market-baseline", "market-baseline"].includes(readRawString(result, "kind") ?? "");
}

function strongestSignal(results: CompResult[]): CompResult | null {
  return results.reduce<CompResult | null>((best, result) => {
    if (!best) return result;
    return result.sampleSize > best.sampleSize ? result : best;
  }, null);
}

function rawBaselineConsensus(baselines: CompResult[]): { headline: CompResult; highPence: number; spreadPct: number } | null {
  const priced = baselines.filter((result) => result.medianPence > 0);
  if (priced.length < 2) return null;

  const medians = priced.map((result) => result.medianPence);
  const low = Math.min(...medians);
  const high = Math.max(...medians);
  const spreadPct = low > 0 ? ((high - low) / low) * 100 : Number.POSITIVE_INFINITY;
  if (spreadPct > 35) return null;

  return {
    headline: ukRelevantBaseline(priced) ?? strongestSignal(priced) ?? priced[0]!,
    highPence: high,
    spreadPct,
  };
}

function smartIsHighOutlier(smart: CompResult, consensus: { highPence: number }): boolean {
  return smart.medianPence > consensus.highPence * 1.25;
}

function ukRelevantBaseline(results: CompResult[]): CompResult | null {
  return (
    results.find(
      (result) =>
        readRawString(result, "kind") === "catalog-market-baseline" &&
        readRawNestedString(result, ["chosenSignal", "source"]) === "cardmarket",
    ) ?? null
  );
}

function readRawString(result: CompResult, key: string): string | null {
  if (!result.raw || typeof result.raw !== "object") return null;
  const value = (result.raw as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readRawNestedString(result: CompResult, path: string[]): string | null {
  if (!result.raw || typeof result.raw !== "object") return null;
  let value: unknown = result.raw;
  for (const key of path) {
    if (!value || typeof value !== "object") return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" ? value : null;
}

/** Material disagreement = spread of medians >15% of the smallest non-zero median. */
export function detectDisagreement(results: CompResult[]): boolean {
  const medians = results.map((r) => r.medianPence).filter((m) => m > 0);
  if (medians.length < 2) return false;
  const min = Math.min(...medians);
  const max = Math.max(...medians);
  return (max - min) / min > 0.15;
}
