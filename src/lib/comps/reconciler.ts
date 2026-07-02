import type { Grade } from "../domain/types.js";

export type ReconSource =
  | "owned-sales"
  | "ebay-insights"
  | "pt-smart"
  | "pt-median"
  | "tcg-market"
  | "poketrace";

export type ReconRegion = "UK" | "EU" | "US";
export type ReconConfidence = "high" | "medium" | "low";

export interface ReconQuery {
  setId?: string;
  cardNumber?: string;
  language?: string;
  gradeBucket: Grade | string;
  isVintage?: boolean;
  ambiguous?: boolean;
}

export interface ReconCandidate {
  source: ReconSource;
  valuePence: number;
  n: number;
  ageDays?: number;
  region: ReconRegion;
  matchedSetId?: string;
  matchedCardNumber?: string;
  matchedLanguage?: string;
  raw?: {
    min?: number;
    max?: number;
    median?: number;
    count?: number;
  };
  fields?: {
    trendPrice?: number;
    avg30?: number;
    avg7?: number;
    low?: number;
  };
  trendPct?: number | null;
  trendWindowDays?: number;
  trendBucketDaysApart?: number;
  candidateHasGradeScopedData?: boolean;
}

export interface ReconResult {
  headlinePence: number | null;
  confidence: ReconConfidence;
  manualCheck: boolean;
  reasons: string[];
  chosenSource?: ReconSource;
  trendPct: number | null;
}

interface CandidateState {
  candidate: ReconCandidate;
  valuePence: number;
  n: number;
  ageDays: number;
  excluded: boolean;
  corroborationOnly: boolean;
  reasons: string[];
  penalties: Array<{ factor: number; quality: boolean }>;
  penaltyProduct: number;
  qualityPenaltyProduct: number;
  regionFactor: number;
  weight: number;
  trendPct: number | null;
  trendSuppressed: boolean;
}

const TIER_WEIGHT: Record<ReconSource, number> = {
  "owned-sales": 1,
  "ebay-insights": 0.95,
  "pt-smart": 0.75,
  "pt-median": 0.7,
  "tcg-market": 0.65,
  poketrace: 0.6,
};

const TIER_ORDER: ReconSource[] = ["owned-sales", "ebay-insights", "pt-smart", "pt-median", "tcg-market", "poketrace"];

export function reconcileComps(query: ReconQuery, candidates: ReconCandidate[]): ReconResult {
  const states = candidates.map((candidate) => initialState(candidate));
  const reasons: string[] = [];

  for (const state of states) {
    applyIdentityGate(state, query);
    applyValidityGate(state);
    applySourceSanityGates(state, query);
  }

  applyDominantSourceOutlierGate(states);

  for (const state of states) {
    applyCorroborationGates(state);
    applyPenalties(state, query);
    applyTrendSuppression(state);
    state.weight = state.excluded ? 0 : candidateWeight(state);
    reasons.push(...state.reasons);
  }

  const eligible = states.filter((state) => !state.excluded && !state.corroborationOnly && state.weight >= 0.1);
  if (eligible.length === 0) {
    const fallback = bestCorroborationOnly(states);
    return {
      headlinePence: fallback?.valuePence ?? null,
      confidence: "low",
      manualCheck: true,
      reasons: [...reasons, fallback ? reasonFor(fallback, "corroboration-fallback") : "no-eligible-candidates"],
      chosenSource: fallback?.candidate.source,
      trendPct: null,
    };
  }

  const chosen = pickEligibleHeadline(eligible);
  const peers = eligible.filter((state) => state.weight >= 0.3 * chosen.weight);
  const spreadPeer = spreadRatio(peers.map((state) => state.valuePence));
  const spreadAll = spreadRatio(eligible.map((state) => state.valuePence));
  const everyEligibleHeavyPenalty = eligible.every((state) => state.qualityPenaltyProduct < 0.5);
  const hardExclusions = states.filter((state) => state.excluded).length;
  const dominantOutlierExcluded = states.some((state) => state.reasons.some((reason) => reason.includes("dominant-source-outlier")));
  const ownedDeviation = ownedSalesDeviation(chosen, states);
  const staleCorroborationDisagrees = states.some(
    (state) =>
      !state.excluded &&
      state.corroborationOnly &&
      state.valuePence > 0 &&
      spreadRatio([state.valuePence, chosen.valuePence]) > 1.4,
  );

  const capsMedium =
    Boolean(query.ambiguous) ||
    (isGraded(query.gradeBucket) && eligible.length === 1) ||
    chosen.qualityPenaltyProduct < 1 ||
    chosen.trendSuppressed ||
    staleCorroborationDisagrees;

  const confidence = confidenceFor({
    chosen,
    peers,
    spreadPeer,
    capsMedium,
    everyEligibleHeavyPenalty,
  });

  const manualCheck =
    confidence === "low" ||
    spreadAll > 1.4 ||
    Boolean(query.ambiguous) ||
    chosen.qualityPenaltyProduct <= 0.5 ||
    hardExclusions >= 2 ||
    dominantOutlierExcluded ||
    ownedDeviation ||
    staleCorroborationDisagrees;

  return {
    headlinePence: chosen.valuePence,
    confidence,
    manualCheck,
    reasons: reasons.length > 0 ? reasons : ["reconciled-cleanly"],
    chosenSource: chosen.candidate.source,
    trendPct: chosen.trendPct,
  };
}

function initialState(candidate: ReconCandidate): CandidateState {
  return {
    candidate,
    valuePence: Math.round(candidate.valuePence),
    n: Math.round(candidate.n),
    ageDays: candidate.ageDays ?? Number.POSITIVE_INFINITY,
    excluded: false,
    corroborationOnly: false,
    reasons: [],
    penalties: [],
    penaltyProduct: 1,
    qualityPenaltyProduct: 1,
    regionFactor: 1,
    weight: 0,
    trendPct: candidate.trendPct ?? null,
    trendSuppressed: false,
  };
}

function applyIdentityGate(state: CandidateState, query: ReconQuery): void {
  if (state.excluded) return;
  const candidate = state.candidate;
  if (query.setId && candidate.matchedSetId && candidate.matchedSetId !== query.setId) {
    exclude(state, `identity-set:${candidate.source}`);
  }
  if (query.cardNumber && candidate.matchedCardNumber && !numbersMatch(candidate.matchedCardNumber, query.cardNumber)) {
    exclude(state, `identity-number:${candidate.source}`);
  }
  if (query.language && candidate.matchedLanguage && candidate.matchedLanguage !== query.language) {
    exclude(state, `identity-language:${candidate.source}`);
  }
  if (isGraded(query.gradeBucket) && candidate.source === "poketrace" && !candidateIsGradeScoped(candidate)) {
    exclude(state, "identity-graded-raw-baseline:poketrace");
  }
}

function applyValidityGate(state: CandidateState): void {
  if (state.excluded) return;
  if (state.valuePence <= 0 || state.valuePence > 100_000_000 || state.n <= 0) {
    exclude(state, `invalid-value:${state.candidate.source}`);
  }
}

function applySourceSanityGates(state: CandidateState, query: ReconQuery): void {
  if (state.excluded) return;
  if (state.candidate.source === "pt-smart") {
    const stats = state.candidate.raw;
    if (stats?.max != null && state.valuePence > stats.max) exclude(state, "smart-out-of-band:pt-smart");
    if (stats?.min != null && state.valuePence < stats.min) exclude(state, "smart-out-of-band:pt-smart");
    if (!state.excluded && stats?.median && state.valuePence / stats.median > 2) {
      exclude(state, "smart-diverges-from-own-median:pt-smart");
    }
  }

  if (state.candidate.source === "tcg-market") {
    if (query.isVintage && query.gradeBucket === "RAW") {
      exclude(state, "tcg-vintage-raw-excluded");
      return;
    }
    const trendPrice = state.candidate.fields?.trendPrice;
    const avg30 = state.candidate.fields?.avg30;
    if (trendPrice && avg30 && avg30 > 0 && trendPrice / avg30 > 1.5) {
      state.valuePence = Math.round(avg30);
      state.reasons.push("tcg-used-avg30-over-trendPrice");
    }
  }
}

function applyDominantSourceOutlierGate(states: CandidateState[]): void {
  const survivors = states.filter((state) => !state.excluded && state.valuePence > 0 && state.n > 0);
  if (survivors.length < 2) return;
  const dominant = survivors.reduce((best, state) => (state.n > best.n ? state : best));
  for (const state of survivors) {
    if (state === dominant) continue;
    if (dominant.n >= 50 * state.n && dominant.n >= 500 && spreadRatio([state.valuePence, dominant.valuePence]) > 3) {
      exclude(state, `dominant-source-outlier:${state.candidate.source}:vs:${dominant.candidate.source}`);
    }
  }
}

function applyCorroborationGates(state: CandidateState): void {
  if (state.excluded) return;
  if (state.ageDays > 180) {
    state.corroborationOnly = true;
    state.reasons.push(`corroboration-stale:${state.candidate.source}`);
  }
  if (state.candidate.source === "owned-sales" && (state.n < 3 || state.ageDays > 120)) {
    state.corroborationOnly = true;
    state.reasons.push("corroboration-thin-owned-sales");
  }
}

function applyPenalties(state: CandidateState, query: ReconQuery): void {
  if (state.excluded) return;
  const spread = rawSpread(state.candidate.raw);
  if (query.gradeBucket === "RAW" && (state.candidate.source === "pt-smart" || state.candidate.source === "pt-median") && spread > 8) {
    penalty(state, 0.3, "penalty-raw-bucket-spread");
  }
  const gradedTail = gradedTailRatio(state.candidate.raw, state.valuePence);
  if (isGraded(query.gradeBucket) && gradedTail > 3) {
    penalty(state, 0.6, "penalty-graded-tail-spread");
  }
  if (state.ageDays <= 30) {
    penalty(state, 1, "penalty-fresh");
  } else if (state.ageDays <= 90) {
    penalty(state, 0.7, "penalty-age-90");
  } else if (state.ageDays <= 180) {
    penalty(state, 0.4, "penalty-age-180");
  }

  const region = state.candidate.region === "UK" ? 1 : state.candidate.region === "EU" ? 0.9 : 0.8;
  penalty(state, region, `penalty-region-${state.candidate.region.toLowerCase()}`);

  if (state.candidate.source === "pt-smart" && !state.candidate.raw) {
    penalty(state, 0.5, "penalty-pt-smart-no-raw-stats");
  }

  state.qualityPenaltyProduct = qualityPenaltyProduct(state);
  state.regionFactor = regionFactor(state);
  state.penaltyProduct = state.qualityPenaltyProduct * state.regionFactor;
}

function applyTrendSuppression(state: CandidateState): void {
  const trend = state.candidate.trendPct;
  const trendWindow = state.candidate.trendWindowDays ?? state.ageDays;
  const bucketDays = state.candidate.trendBucketDaysApart;
  if (trend == null) {
    state.trendPct = null;
    return;
  }
  if (Math.abs(trend) > 100 && trendWindow <= 90) {
    state.trendPct = null;
    state.trendSuppressed = true;
    state.reasons.push(`trend-suppressed:${state.candidate.source}`);
    return;
  }
  if (bucketDays != null && bucketDays < 14) {
    state.trendPct = null;
    state.trendSuppressed = true;
    state.reasons.push(`trend-insufficient-history:${state.candidate.source}`);
    return;
  }
  state.trendPct = trend;
}

function candidateWeight(state: CandidateState): number {
  const tier = TIER_WEIGHT[state.candidate.source];
  const weight = tier * sizeFactor(state.n) * state.qualityPenaltyProduct * state.regionFactor;
  if (state.candidate.source === "owned-sales" && !state.corroborationOnly) {
    return Math.max(weight, 0.45);
  }
  return weight;
}

function sizeFactor(n: number): number {
  return Math.min(1, Math.log10(n + 1) / 3);
}

function pickEligibleHeadline(eligible: CandidateState[]): CandidateState {
  const owned = eligible
    .filter((state) => state.candidate.source === "owned-sales" && !state.corroborationOnly)
    .sort((a, b) => b.n - a.n)[0];
  if (owned) return owned;

  return eligible.reduce((best, state) => {
    if (state.weight !== best.weight) return state.weight > best.weight ? state : best;
    const tierDelta = TIER_ORDER.indexOf(state.candidate.source) - TIER_ORDER.indexOf(best.candidate.source);
    if (tierDelta !== 0) return tierDelta < 0 ? state : best;
    return state.n > best.n ? state : best;
  });
}

function bestCorroborationOnly(states: CandidateState[]): CandidateState | null {
  const pool = states.filter((state) => !state.excluded && state.corroborationOnly && state.valuePence > 0);
  if (pool.length === 0) return null;
  return pool.reduce((best, state) => (state.n > best.n ? state : best));
}

function confidenceFor(input: {
  chosen: CandidateState;
  peers: CandidateState[];
  spreadPeer: number;
  capsMedium: boolean;
  everyEligibleHeavyPenalty: boolean;
}): ReconConfidence {
  if (input.chosen.weight < 0.25 || input.spreadPeer > 1.4 || input.everyEligibleHeavyPenalty) return "low";
  if (input.chosen.weight >= 0.45 && (input.peers.length === 1 || input.spreadPeer <= 1.25) && !input.capsMedium) {
    return "high";
  }
  return "medium";
}

function ownedSalesDeviation(chosen: CandidateState, states: CandidateState[]): boolean {
  return states.some(
    (state) =>
      state.candidate.source === "owned-sales" &&
      !state.excluded &&
      state.corroborationOnly &&
      state.valuePence > 0 &&
      spreadRatio([state.valuePence, chosen.valuePence]) > 1.4,
  );
}

function rawSpread(raw: ReconCandidate["raw"]): number {
  if (!raw?.min || !raw.max || raw.min <= 0) return 1;
  return raw.max / raw.min;
}

function gradedTailRatio(raw: ReconCandidate["raw"], valuePence: number): number {
  if (!raw?.min || !raw.max || raw.min <= 0 || raw.max <= 0 || valuePence <= 0) return 1;
  return Math.max(raw.max / valuePence, valuePence / raw.min);
}

function spreadRatio(values: number[]): number {
  const positive = values.filter((value) => value > 0);
  if (positive.length < 2) return 1;
  return Math.max(...positive) / Math.min(...positive);
}

function penalty(state: CandidateState, factor: number, reason: string): void {
  state.penalties.push({ factor, quality: !reason.startsWith("penalty-region") });
  if (factor < 1) state.reasons.push(`${reason}:${state.candidate.source}`);
}

function qualityPenaltyProduct(state: CandidateState): number {
  return state.penalties
    .filter((entry) => entry.quality)
    .reduce((product, entry) => product * entry.factor, 1);
}

function regionFactor(state: CandidateState): number {
  return state.penalties
    .filter((entry) => !entry.quality)
    .reduce((product, entry) => product * entry.factor, 1);
}

function exclude(state: CandidateState, reason: string): void {
  state.excluded = true;
  state.reasons.push(reason);
}

function reasonFor(state: CandidateState, reason: string): string {
  return `${reason}:${state.candidate.source}`;
}

function isGraded(gradeBucket: Grade | string): boolean {
  return gradeBucket !== "RAW";
}

function candidateIsGradeScoped(candidate: ReconCandidate): boolean {
  return candidate.source === "poketrace" && candidate.candidateHasGradeScopedData === true;
}

function numbersMatch(actual: string, expected: string): boolean {
  return numberForms(actual).some((form) => numberForms(expected).includes(form));
}

function numberForms(value: string): string[] {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  const left = normalized.split("/")[0] ?? normalized;
  const stripLeading = (part: string) => part.replace(/^([A-Z]*?)0+(\d)/, "$1$2");
  const prefixless = left.replace(/^(?:SVP|MEP|SWSH|SM|XY|BW|DP|HGSS)0*(\d+)$/, "$1");
  return [...new Set([normalized, left, stripLeading(left), prefixless, stripLeading(prefixless)].filter(Boolean))];
}
