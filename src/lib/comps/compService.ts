// Orchestration: query every configured source, then reconcile to one headline comp.
// Reconciliation rule (v1): prefer the confident result with the largest sample;
// if none are confident, take the largest sample anyway but flag low confidence.
// All individual results are returned too, so the UI can show cross-source spread.

import { GRADE_VALUES, type CardRef, type CompQuery, type CompResult, type Grade } from "../domain/types.js";
import { getSetById, resolveSetIdForCard } from "../catalog/setCatalog.js";
import type { CompSource } from "./CompSource.js";
import { DEFAULT_WINDOW_DAYS, isConfident } from "./cleaning.js";
import { PokemonTcgMarketSource } from "./sources/pokemonTcgMarket.js";
import { PokemonPriceTrackerSource } from "./sources/pokemonPriceTracker.js";
import { PokeTraceSource } from "./sources/pokeTrace.js";
import { EbayMarketplaceInsightsSource, isEbayMarketplaceInsightsEnabled } from "./sources/ebayMarketplaceInsights.js";
import { reconcileComps, type ReconCandidate, type ReconQuery, type ReconResult, type ReconSource } from "./reconciler.js";
import { recordSourceSuccess } from "../system/sourceFreshness.js";

const DEFAULT_SOURCE_TIMEOUT_MS = 4000;
const DEFAULT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SourceUnavailable {
  name: string;
  reason: string;
}

export interface CachedCompBadge {
  asOf: string;
  ageHours: number;
}

export interface CachedCompRecord {
  headline: CompResult;
  reconciliation?: ReconResult;
  cachedAt: string;
}

export interface LastKnownCompCache {
  get(card: CardRef, query: CompQuery): Promise<CachedCompRecord | null>;
}

export interface ReconciledComp {
  /** The single comp to act on. */
  headline: CompResult | null;
  /** Every source's result, for transparency / disagreement display. */
  all: CompResult[];
  /** True when sources disagree materially on the median (>15%). */
  sourcesDisagree: boolean;
  /** Deterministic data-quality verdict used to explain the headline choice. */
  reconciliation?: ReconResult;
  /** Sources that failed/timed out during this lookup, shown as unavailable evidence. */
  unavailableSources?: SourceUnavailable[];
  /** Present when no fresh source produced a price and a recent cached result is being shown. */
  cached?: CachedCompBadge;
}

export type CompSourceProgressStatus = "priced" | "empty" | "unavailable";

export interface CompSourceProgress {
  source: { name: string; live: boolean };
  status: CompSourceProgressStatus;
  latencyMs: number;
  completed: number;
  total: number;
  result: CompResult;
  /** A complete confidence receipt over evidence received so far. */
  receipt: ReconciledComp;
}

export interface CompLookupOptions {
  ambiguous?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: CompSourceProgress) => void | Promise<void>;
}

export class CompService {
  constructor(
    private readonly sources: CompSource[],
    private readonly sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
    private readonly cache: LastKnownCompCache | null = null,
    private readonly cacheMaxAgeMs = DEFAULT_CACHE_MAX_AGE_MS,
  ) {}

  /** Default wiring. Add PokeTrace etc. here as adapters are built. */
  static default(): CompService {
    return new CompService(defaultCompSources());
  }

  /** Names + live status of configured sources (for diagnostics / UI). */
  get sourceSummaries(): { name: string; live: boolean }[] {
    return this.sources.map((s) => ({ name: s.name, live: s.live }));
  }

  async lookup(
    card: CardRef,
    query: CompQuery = {},
    options: CompLookupOptions = {},
  ): Promise<ReconciledComp> {
    const results: Array<CompResult | undefined> = new Array(this.sources.length);
    let completed = 0;
    await Promise.all(
      this.sources.map(async (source, index) => {
        const started = Date.now();
        const result = await this.lookupSource(source, card, query, options.signal);
        results[index] = result;
        completed += 1;
        const allSoFar = results.filter((item): item is CompResult => Boolean(item));
        const receipt = reconcileFreshResults(allSoFar, card, query, options);
        const progress: CompSourceProgress = {
          source: { name: source.name, live: source.live },
          status: sourceProgressStatus(result),
          latencyMs: Date.now() - started,
          completed,
          total: this.sources.length,
          result,
          receipt,
        };
        if (progress.status === "priced") recordSourceSuccess(source.name);
        logSourceProgress(progress);
        await options.onProgress?.(progress);
      }),
    );
    const all = results.filter((item): item is CompResult => Boolean(item));
    const unavailableSources = unavailableFromResults(all);

    if (all.length === 0) {
      throw new Error("All comp sources failed");
    }

    if (!hasPricedSignal(all)) {
      const cached = await this.readWarmCache(card, query);
      if (cached && hasPricedSignal([cached.headline])) {
        const cachedAtMs = new Date(cached.cachedAt).getTime();
        const ageHours = Number.isFinite(cachedAtMs)
          ? Math.max(0, Math.round((Date.now() - cachedAtMs) / (60 * 60 * 1000)))
          : 0;
        const reconciliation =
          cached.reconciliation ??
          reconcileComps(buildReconQuery(cached.headline.card, { ...query, grade: cached.headline.grade }, options), [
            resultToReconCandidate(cached.headline),
          ].filter((candidate): candidate is ReconCandidate => candidate != null));
        return {
          headline: applyCachedFlag(applyReconciliation(cached.headline, reconciliation), cached.cachedAt),
          all: [applyCachedFlag(cached.headline, cached.cachedAt), ...all],
          sourcesDisagree: false,
          reconciliation,
          unavailableSources,
          cached: { asOf: cached.cachedAt, ageHours },
        };
      }
    }

    const fresh = reconcileFreshResults(all, card, query, options);
    return { ...fresh, unavailableSources };
  }

  private async readWarmCache(card: CardRef, query: CompQuery): Promise<CachedCompRecord | null> {
    if (!this.cache) return null;
    const cached = await maybe(this.cache.get(card, query));
    if (!cached) return null;
    const cachedAtMs = new Date(cached.cachedAt).getTime();
    if (!Number.isFinite(cachedAtMs)) return null;
    if (Date.now() - cachedAtMs > this.cacheMaxAgeMs) return null;
    return cached;
  }

  private async lookupSource(
    source: CompSource,
    card: CardRef,
    query: CompQuery,
    callerSignal?: AbortSignal,
  ): Promise<CompResult> {
    const fallback = (reason: string): CompResult => emptySourceComp(source.name, card, query, reason);
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) abortFromCaller();
    else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      return await withTimeout(
        source.lookup(card, query, { signal: controller.signal }),
        this.sourceTimeoutMs,
        () => {
          controller.abort(new Error(`${source.name} timed out`));
          return fallback(`${source.name} timed out`);
        },
        callerSignal,
        () => fallback(`${source.name} cancelled`),
      );
    } catch (err) {
      return fallback(err instanceof Error ? `${source.name} failed: ${err.message}` : `${source.name} failed`);
    } finally {
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

export function defaultCompSources(): CompSource[] {
  const sources: CompSource[] = [new PokemonPriceTrackerSource()];
  if (isEbayMarketplaceInsightsEnabled()) sources.push(new EbayMarketplaceInsightsSource());
  sources.push(new PokeTraceSource(), new PokemonTcgMarketSource());
  return sources;
}

export class MemoryLastKnownCompCache implements LastKnownCompCache {
  private readonly rows = new Map<string, CachedCompRecord>();

  constructor(rows: CachedCompRecord[] = []) {
    for (const row of rows) this.set(row.headline.card, { grade: row.headline.grade }, row);
  }

  async get(card: CardRef, query: CompQuery): Promise<CachedCompRecord | null> {
    return this.rows.get(cacheKey(card, query)) ?? null;
  }

  set(card: CardRef, query: CompQuery, row: CachedCompRecord): void {
    this.rows.set(cacheKey(card, query), row);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: () => T,
  signal?: AbortSignal,
  cancelled: () => T = fallback,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => resolve(cancelled()));
    const timer = setTimeout(() => finish(() => resolve(fallback())), timeoutMs);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        finish(() => resolve(value));
      },
      (err) => {
        finish(() => reject(err));
      },
    );
  });
}

function reconcileFreshResults(
  all: CompResult[],
  card: CardRef,
  query: CompQuery,
  options: Pick<CompLookupOptions, "ambiguous">,
): ReconciledComp {
  const { headline, reconciliation } = pickHeadlineForQuery(all, card, query, options);
  return {
    headline,
    all,
    sourcesDisagree: detectDisagreement(all) || reconciliation.manualCheck,
    reconciliation,
    unavailableSources: unavailableFromResults(all),
  };
}

function sourceProgressStatus(result: CompResult): CompSourceProgressStatus {
  if (result.sampleSize > 0 && result.medianPence > 0) return "priced";
  return readRawString(result, "reason") ? "unavailable" : "empty";
}

function logSourceProgress(progress: CompSourceProgress): void {
  console.info(JSON.stringify({
    event: "comp_source_settled",
    source: progress.source.name,
    live: progress.source.live,
    status: progress.status,
    latencyMs: progress.latencyMs,
    sampleSize: progress.result.sampleSize,
    windowDays: progress.result.windowDays,
    completed: progress.completed,
    total: progress.total,
  }));
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

function unavailableFromResults(results: CompResult[]): SourceUnavailable[] {
  return results
    .filter((result) => result.sampleSize <= 0 && result.medianPence <= 0)
    .map((result) => ({ name: result.source, reason: readRawString(result, "reason") ?? "source unavailable" }))
    .filter((source) => /timed out|failed|unavailable/i.test(source.reason));
}

function hasPricedSignal(results: CompResult[]): boolean {
  return results.some((result) => result.sampleSize > 0 && result.medianPence > 0);
}

async function maybe<T>(value: Promise<T>): Promise<T | null> {
  try {
    return await value;
  } catch {
    return null;
  }
}

function applyCachedFlag(result: CompResult, cachedAt: string): CompResult {
  return {
    ...result,
    raw: {
      ...(result.raw && typeof result.raw === "object" ? result.raw : {}),
      cached: true,
      cachedAt,
    },
  };
}

function cacheKey(card: CardRef, query: CompQuery): string {
  return [
    card.tcgApiId ?? "",
    card.name.trim().toLowerCase(),
    (card.setName ?? "").trim().toLowerCase(),
    (card.number ?? "").trim().toLowerCase(),
    query.grade ?? "RAW",
  ].join("|");
}

export function pickHeadlineForQuery(
  results: CompResult[],
  card: CardRef,
  query: CompQuery = {},
  options: { ambiguous?: boolean } = {},
): { headline: CompResult | null; reconciliation: ReconResult } {
  const reconQuery = buildReconQuery(card, query, options);
  const candidates = results.map((result) => resultToReconCandidate(result)).filter((candidate): candidate is ReconCandidate => candidate != null);
  const reconciliation = reconcileComps(reconQuery, candidates);
  if (reconciliation.headlinePence == null || !reconciliation.chosenSource) {
    return { headline: null, reconciliation };
  }
  const chosen = reconciliation.chosenSource
    ? pickCompForReconSource(results, reconciliation.chosenSource, reconciliation.headlinePence)
    : null;
  const headline = chosen ? applyReconciliation(chosen, reconciliation) : null;
  return { headline, reconciliation };
}

/** Re-run only the pure reconciler when late identity/ambiguity evidence lands. */
export function reconcileCompReceipt(
  receipt: ReconciledComp,
  card: CardRef,
  query: CompQuery = {},
  options: Pick<CompLookupOptions, "ambiguous"> = {},
): ReconciledComp {
  const revised = reconcileFreshResults(receipt.all, card, query, options);
  return {
    ...receipt,
    ...revised,
    unavailableSources: receipt.unavailableSources ?? revised.unavailableSources,
    cached: receipt.cached,
  };
}

/** Largest confident sample wins; fall back to largest sample of any. */
export function pickHeadline(results: CompResult[]): CompResult {
  // Nothing is a better comp than what you actually sold the exact card+grade
  // for. When an owned-sales signal is present it anchors the headline ahead of
  // every external source, regardless of their sample size. Cross-source
  // disagreement is still computed from `all`, so a thin or divergent owned
  // sale surfaces a "cross-check" verdict rather than being trusted blindly.
  const owned = pickOwnedSalesHeadline(results);
  if (owned) return owned;

  const rawHeadline = pickRawHeadline(results);
  if (rawHeadline) return rawHeadline;

  const confident = results.filter((r) => isConfident(r));
  const pool = confident.length > 0 ? confident : results;
  return pool.reduce((best, r) => (r.sampleSize > best.sampleSize ? r : best));
}

function buildReconQuery(card: CardRef, query: CompQuery, options: { ambiguous?: boolean }): ReconQuery {
  const setId = resolveSetIdForCard(card.setName, card.number) ?? setIdFromTcgApiId(card.tcgApiId);
  return {
    setId,
    cardNumber: card.number,
    language: card.language ?? "EN",
    gradeBucket: query.grade ?? "RAW",
    isVintage: isVintageSet(setId),
    ambiguous: Boolean(options.ambiguous),
  };
}

function resultToReconCandidate(result: CompResult): ReconCandidate | null {
  if (result.sampleSize <= 0 || result.medianPence <= 0) return null;
  const source = reconSource(result);
  if (!source) return null;
  const raw = result.raw && typeof result.raw === "object" ? (result.raw as Record<string, unknown>) : {};
  const providerCard = raw.providerCard && typeof raw.providerCard === "object" ? (raw.providerCard as CardRef) : null;
  const matchedCard = providerCard ?? result.card;
  const fields = source === "tcg-market" ? readTcgMarketFields(raw, result.medianPence) : undefined;
  const sample = reconcilerSampleSize(result, raw);
  const fx = readFxMetadata(result, raw);
  return {
    source,
    valuePence: result.medianPence,
    n: sample.n,
    ageDays: ageDays(result.asOf),
    region: reconRegion(result),
    matchedSetId: resolveSetIdForCard(matchedCard.setName, matchedCard.number) ?? setIdFromTcgApiId(matchedCard.tcgApiId),
    matchedCardNumber: matchedCard.number,
    matchedLanguage: matchedCard.language ?? "EN",
    raw: readRawStats(result),
    fields,
    trendPct: result.trendPct,
    trendWindowDays: result.windowDays,
    candidateHasGradeScopedData: source === "poketrace" && raw.kind === "sold-aggregate",
    nBoostedByAgreeingSignals: sample.boosted,
    adjacentLowerGradeMedianPence: adjacentLowerGradeMedianPence(result.grade, raw),
    convertedFromNonGbp: fx.convertedFromNonGbp,
    fxAgeDays: fx.ageDays,
  };
}

function reconcilerSampleSize(result: CompResult, raw: Record<string, unknown>): { n: number; boosted: boolean } {
  if (result.source !== "poketrace") return { n: result.sampleSize, boosted: false };
  const corroborating = corroboratingPokeTraceSignalSampleSize(raw, result.medianPence);
  const n = Math.max(result.sampleSize, corroborating);
  return { n, boosted: n > result.sampleSize };
}

function corroboratingPokeTraceSignalSampleSize(raw: Record<string, unknown>, headlinePence: number): number {
  if (headlinePence <= 0 || !Array.isArray(raw.signals)) return 0;
  const agreeingSamples = raw.signals
    .map((signal) => {
      if (!signal || typeof signal !== "object") return 0;
      const medianPence = Number((signal as { medianPence?: unknown }).medianPence);
      const sampleSize = Number((signal as { sampleSize?: unknown }).sampleSize);
      if (!Number.isFinite(medianPence) || medianPence <= 0) return 0;
      if (!Number.isInteger(sampleSize) || sampleSize <= 0) return 0;
      const spread = Math.max(medianPence, headlinePence) / Math.min(medianPence, headlinePence);
      return spread <= 1.15 ? sampleSize : 0;
    })
    .filter((sampleSize) => sampleSize > 0);
  return agreeingSamples.length > 0 ? Math.max(...agreeingSamples) : 0;
}

function adjacentLowerGradeMedianPence(grade: Grade, raw: Record<string, unknown>): number | undefined {
  const lower = adjacentLowerGrade(grade);
  if (!lower || !Array.isArray(raw.gradeLadder)) return undefined;
  const row = raw.gradeLadder.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as { grade?: unknown }).grade === lower;
  }) as { medianPence?: unknown } | undefined;
  const median = Number(row?.medianPence);
  return Number.isFinite(median) && median > 0 ? median : undefined;
}

function adjacentLowerGrade(grade: Grade): Grade | null {
  const index = GRADE_VALUES.indexOf(grade);
  if (index <= 0) return null;
  const prefix = grade.split("_")[0];
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = GRADE_VALUES[i]!;
    if (candidate === "RAW") return null;
    if (candidate.startsWith(`${prefix}_`)) return candidate;
  }
  return null;
}

function readFxMetadata(result: CompResult, raw: Record<string, unknown>): { convertedFromNonGbp: boolean; ageDays?: number } {
  const fx = raw.fx && typeof raw.fx === "object" ? (raw.fx as Record<string, unknown>) : null;
  const age = Number(fx?.ageDays);
  const ageDays = Number.isFinite(age) ? age : undefined;
  const chosenSignal = raw.chosenSignal && typeof raw.chosenSignal === "object" ? (raw.chosenSignal as Record<string, unknown>) : null;
  const rawCurrency = typeof raw.currency === "string" ? raw.currency.toUpperCase() : "";
  const signalCurrency = typeof chosenSignal?.originalCurrency === "string" ? chosenSignal.originalCurrency.toUpperCase() : "";
  const convertedFromNonGbp =
    Boolean(fx) &&
    (rawCurrency === "USD" ||
      rawCurrency === "EUR" ||
      rawCurrency === "JPY" ||
      signalCurrency === "USD" ||
      signalCurrency === "EUR" ||
      signalCurrency === "JPY" ||
      result.source === "pokemon-price-tracker");
  return { convertedFromNonGbp, ageDays };
}

function reconSource(result: CompResult): ReconSource | null {
  if (result.source === "owned-sales") return "owned-sales";
  if (result.source === "ebay-marketplace-insights") return "ebay-insights";
  if (result.source === "checked-comps") return "checked-comps";
  if (result.source === "pokemon-price-tracker") {
    return readRawString(result, "chosenPriceSource") === "smartMarketPrice" ? "pt-smart" : "pt-median";
  }
  if (result.source === "pokemon-tcg-market") return "tcg-market";
  if (result.source === "poketrace") return "poketrace";
  return null;
}

function reconRegion(result: CompResult): "UK" | "EU" | "US" {
  if (result.source === "ebay-marketplace-insights" || result.source === "owned-sales") return "UK";
  const raw = result.raw && typeof result.raw === "object" ? (result.raw as Record<string, unknown>) : {};
  if (result.source === "checked-comps") {
    const region = typeof raw.region === "string" ? raw.region.toUpperCase() : "";
    return region === "EU" ? "EU" : "UK";
  }
  const market = typeof raw.market === "string" ? raw.market.toUpperCase() : "";
  if (market === "EU") return "EU";
  if (market === "US") return "US";
  if (result.source === "pokemon-tcg-market") {
    const chosen = raw.chosenSignal && typeof raw.chosenSignal === "object" ? (raw.chosenSignal as Record<string, unknown>) : null;
    return chosen?.source === "cardmarket" ? "EU" : "US";
  }
  return "US";
}

function readRawStats(result: CompResult): ReconCandidate["raw"] | undefined {
  if (result.source === "pokemon-price-tracker") {
    return {
      min: result.lowPence,
      max: result.highPence,
      median: readRawString(result, "chosenPriceSource") === "smartMarketPrice" ? result.meanPence || result.medianPence : result.medianPence,
      count: result.sampleSize,
    };
  }
  if (result.highPence > 0 && result.lowPence > 0 && result.highPence !== result.lowPence) {
    return { min: result.lowPence, max: result.highPence, median: result.medianPence, count: result.sampleSize };
  }
  return undefined;
}

function readTcgMarketFields(raw: Record<string, unknown>, fallback: number): ReconCandidate["fields"] {
  const signals = Array.isArray(raw.signals) ? raw.signals : [];
  const price = (kind: string) => {
    const match = signals.find(
      (signal) =>
        signal &&
        typeof signal === "object" &&
        (signal as { source?: unknown }).source === "cardmarket" &&
        (signal as { kind?: unknown }).kind === kind,
    ) as { pricePence?: unknown } | undefined;
    const value = Number(match?.pricePence);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  return {
    trendPrice: price("trendPrice") ?? fallback,
    avg30: price("avg30"),
    avg7: price("avg7"),
    low: price("lowPrice"),
  };
}

function pickCompForReconSource(
  results: CompResult[],
  reconSourceName: ReconSource,
  headlinePence: number | null,
): CompResult | null {
  const matching = results.filter((result) => reconSource(result) === reconSourceName && result.sampleSize > 0 && result.medianPence > 0);
  if (matching.length === 0) return null;
  if (headlinePence != null) {
    const exact = matching.find((result) => result.medianPence === headlinePence);
    if (exact) return exact;
  }
  return matching.reduce((best, result) => (result.sampleSize > best.sampleSize ? result : best));
}

function applyReconciliation(result: CompResult, reconciliation: ReconResult): CompResult {
  const medianPence = reconciliation.headlinePence ?? result.medianPence;
  return {
    ...result,
    medianPence,
    meanPence: medianPence > 0 && result.meanPence <= 0 ? medianPence : result.meanPence,
    lowPence: medianPence > 0 && result.lowPence <= 0 ? medianPence : result.lowPence,
    highPence: medianPence > 0 && result.highPence <= 0 ? medianPence : result.highPence,
    trendPct: reconciliation.chosenSource === reconSource(result) ? reconciliation.trendPct : result.trendPct,
    raw: {
      ...(result.raw && typeof result.raw === "object" ? result.raw : {}),
      reconciliation,
    },
  };
}

function setIdFromTcgApiId(tcgApiId: string | undefined): string | undefined {
  return tcgApiId?.split("-")[0] || undefined;
}

function isVintageSet(setId: string | undefined): boolean {
  const release = setId ? getSetById(setId)?.releaseDate : undefined;
  return Boolean(release && release < "2003-01-01");
}

function ageDays(asOf: string): number {
  const time = new Date(asOf).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
}

function pickOwnedSalesHeadline(results: CompResult[]): CompResult | null {
  const owned = results.filter(
    (r) => r.source === "owned-sales" && r.sampleSize > 0 && r.medianPence > 0,
  );
  if (owned.length === 0) return null;
  return owned.reduce((best, r) => (r.sampleSize > best.sampleSize ? r : best));
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
    headline: preferredRawBaseline(priced) ?? strongestSignal(priced) ?? priced[0]!,
    highPence: high,
    spreadPct,
  };
}

function smartIsHighOutlier(smart: CompResult, consensus: { highPence: number }): boolean {
  return smart.medianPence > consensus.highPence * 1.25;
}

function preferredRawBaseline(results: CompResult[]): CompResult | null {
  return (
    results.find(
      (result) =>
        result.source === "poketrace" &&
        readRawString(result, "kind") === "market-baseline" &&
        readRawString(result, "priceSource") === "cardmarket",
    ) ??
    results.find(
      (result) =>
        result.source === "poketrace" &&
        readRawString(result, "kind") === "market-baseline" &&
        result.sampleSize >= 10,
    ) ??
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
