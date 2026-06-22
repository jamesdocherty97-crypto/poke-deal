// Orchestration: query every configured source, then reconcile to one headline comp.
// Reconciliation rule (v1): prefer the confident result with the largest sample;
// if none are confident, take the largest sample anyway but flag low confidence.
// All individual results are returned too, so the UI can show cross-source spread.

import type { CardRef, CompQuery, CompResult } from "../domain/types.js";
import type { CompSource } from "./CompSource.js";
import { isConfident } from "./cleaning.js";
import { PokemonTcgMarketSource } from "./sources/pokemonTcgMarket.js";
import { PokemonPriceTrackerSource } from "./sources/pokemonPriceTracker.js";

export interface ReconciledComp {
  /** The single comp to act on. */
  headline: CompResult;
  /** Every source's result, for transparency / disagreement display. */
  all: CompResult[];
  /** True when sources disagree materially on the median (>15%). */
  sourcesDisagree: boolean;
}

export class CompService {
  constructor(private readonly sources: CompSource[]) {}

  /** Default wiring. Add PokeTrace etc. here as adapters are built. */
  static default(): CompService {
    return new CompService([new PokemonPriceTrackerSource(), new PokemonTcgMarketSource()]);
  }

  /** Names + live status of configured sources (for diagnostics / UI). */
  get sourceSummaries(): { name: string; live: boolean }[] {
    return this.sources.map((s) => ({ name: s.name, live: s.live }));
  }

  async lookup(card: CardRef, query: CompQuery = {}): Promise<ReconciledComp> {
    const settled = await Promise.allSettled(
      this.sources.map((s) => s.lookup(card, query)),
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
  if (smart) return smart;

  const catalogBaseline = rawResults.find((result) => readRawString(result, "kind") === "catalog-market-baseline");
  if (!catalogBaseline) return null;

  const strongestRawBucket = rawResults
    .filter(
      (result) =>
        result.source !== catalogBaseline.source && readRawString(result, "chosenPriceSource") !== "smartMarketPrice",
    )
    .reduce<CompResult | null>((best, result) => (!best || result.sampleSize > best.sampleSize ? result : best), null);

  if (!strongestRawBucket) return catalogBaseline;
  return detectDisagreement([strongestRawBucket, catalogBaseline]) ? catalogBaseline : null;
}

function readRawString(result: CompResult, key: string): string | null {
  if (!result.raw || typeof result.raw !== "object") return null;
  const value = (result.raw as Record<string, unknown>)[key];
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
