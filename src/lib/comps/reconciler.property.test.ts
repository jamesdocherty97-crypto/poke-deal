import test from "node:test";
import assert from "node:assert/strict";
import { collectorNumbersEquivalent } from "../cards/identity.js";
import {
  reconcileComps,
  type ReconCandidate,
  type ReconQuery,
  type ReconResult,
  type ReconSource,
} from "./reconciler.js";

const DEFAULT_CASE_COUNT = 25_000;
const DEFAULT_SEED = 0xc0dec0de;
const MAX_CASE_COUNT = 1_000_000;
const CASE_COUNT = parseCaseCount(process.env.COMP_RECON_CASES);
const SEED = parseSeed(process.env.COMP_RECON_SEED);

const SOURCES: ReconSource[] = [
  "owned-sales",
  "ebay-insights",
  "checked-comps",
  "pt-smart",
  "pt-median",
  "tcg-market",
  "poketrace",
];

const RAW_QUERY: ReconQuery = {
  setId: "swsh7",
  cardNumber: "94/203",
  language: "EN",
  gradeBucket: "RAW",
  isVintage: false,
  ambiguous: false,
};
const GRADED_QUERY: ReconQuery = { ...RAW_QUERY, gradeBucket: "PSA_10" };

function exactCandidate(
  query: ReconQuery,
  source: ReconSource,
  overrides: Partial<ReconCandidate> = {},
): ReconCandidate {
  return {
    source,
    valuePence: 10_000,
    n: 1,
    ageDays: 1,
    region: "US",
    matchedSetId: query.setId,
    matchedCardNumber: query.cardNumber,
    matchedLanguage: query.language,
    conditionMatched: true,
    candidateHasGradeScopedData: source === "poketrace",
    ...overrides,
  };
}

test("RAW exact catalog guides are fallback-eligible through day 365, but not day 366", () => {
  for (const ageDays of [0, 30, 90, 91, 120, 180, 181, 364, 365]) {
    const result = reconcileComps(RAW_QUERY, [
      exactCandidate(RAW_QUERY, "tcg-market", { ageDays }),
    ]);
    assert.equal(result.headlinePence, 10_000, `expected a catalog guide at ${ageDays}d`);
    assert.equal(result.chosenSource, "tcg-market", `expected catalog source at ${ageDays}d`);
    assert.equal(result.confidence, "low", `expected low confidence at ${ageDays}d`);
    assert.equal(result.manualCheck, true, `expected manual review at ${ageDays}d`);
    assert.match(result.reasons.join(" "), /indicative-fallback:tcg-market/);
  }

  const expired = reconcileComps(RAW_QUERY, [
    exactCandidate(RAW_QUERY, "tcg-market", { ageDays: 366 }),
  ]);
  assert.equal(expired.headlinePence, null);
  assert.equal(expired.chosenSource, undefined);
});

test("catalog fallback requires complete exact identity and an eligible RAW non-vintage query", () => {
  const rejected: Array<{ label: string; query: ReconQuery; candidate: ReconCandidate }> = [
    {
      label: "missing set identity",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "tcg-market", { matchedSetId: undefined }),
    },
    {
      label: "missing number identity",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "tcg-market", { matchedCardNumber: undefined }),
    },
    {
      label: "missing language identity",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "tcg-market", { matchedLanguage: undefined }),
    },
    {
      label: "wrong set identity",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "tcg-market", { matchedSetId: "wrong-set" }),
    },
    {
      label: "wrong number identity",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "tcg-market", { matchedCardNumber: "999/999" }),
    },
    {
      label: "wrong language identity",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "tcg-market", { matchedLanguage: "JP" }),
    },
    {
      label: "vintage RAW query",
      query: { ...RAW_QUERY, isVintage: true },
      candidate: exactCandidate(RAW_QUERY, "tcg-market"),
    },
    {
      label: "graded query",
      query: GRADED_QUERY,
      candidate: exactCandidate(GRADED_QUERY, "tcg-market"),
    },
    {
      label: "query without a stable card identifier",
      query: { ...RAW_QUERY, setId: undefined, cardNumber: undefined },
      candidate: exactCandidate(RAW_QUERY, "tcg-market"),
    },
  ];

  for (const entry of rejected) {
    const result = reconcileComps(entry.query, [entry.candidate]);
    assert.equal(result.headlinePence, null, entry.label);
    assert.equal(result.chosenSource, undefined, entry.label);
  }
});

test("non-catalog fallback is exact, non-corroboration evidence no older than 90 days", () => {
  const day90 = reconcileComps(GRADED_QUERY, [
    exactCandidate(GRADED_QUERY, "pt-median", { ageDays: 90 }),
  ]);
  assert.equal(day90.headlinePence, 10_000);
  assert.equal(day90.chosenSource, "pt-median");
  assert.match(day90.reasons.join(" "), /indicative-fallback:pt-median/);

  const rejected: Array<{ label: string; candidate: ReconCandidate }> = [
    {
      label: "91 days old",
      candidate: exactCandidate(GRADED_QUERY, "pt-median", { ageDays: 91 }),
    },
    {
      label: "missing exact set",
      candidate: exactCandidate(GRADED_QUERY, "pt-median", { matchedSetId: undefined }),
    },
    {
      label: "wrong exact card number",
      candidate: exactCandidate(GRADED_QUERY, "pt-median", { matchedCardNumber: "95/203" }),
    },
    {
      label: "unscoped graded PokeTrace data",
      candidate: exactCandidate(GRADED_QUERY, "poketrace", {
        candidateHasGradeScopedData: false,
      }),
    },
  ];

  for (const entry of rejected) {
    const result = reconcileComps(GRADED_QUERY, [entry.candidate]);
    assert.equal(result.headlinePence, null, entry.label);
    assert.equal(result.chosenSource, undefined, entry.label);
  }
});

test("fallback quality must be strictly greater than 0.5 at spread and age boundaries", () => {
  const rawSpreadAtLimit = reconcileComps(RAW_QUERY, [
    exactCandidate(RAW_QUERY, "pt-median", {
      raw: { min: 1_000, median: 4_000, max: 8_000 },
    }),
  ]);
  assert.equal(rawSpreadAtLimit.headlinePence, 10_000, "RAW spread of exactly 8 should remain eligible");

  const rawSpreadOverLimit = reconcileComps(RAW_QUERY, [
    exactCandidate(RAW_QUERY, "pt-median", {
      raw: { min: 1_000, median: 4_000, max: 8_001 },
    }),
  ]);
  assert.equal(rawSpreadOverLimit.headlinePence, null, "RAW spread over 8 has quality 0.3");

  const gradedTailAtLimit = reconcileComps(GRADED_QUERY, [
    exactCandidate(GRADED_QUERY, "pt-median", {
      raw: { min: 10_000, median: 10_000, max: 30_000 },
    }),
  ]);
  assert.equal(gradedTailAtLimit.headlinePence, 10_000, "graded tail of exactly 3 is not penalised");

  const freshPenalisedTail = reconcileComps(GRADED_QUERY, [
    exactCandidate(GRADED_QUERY, "pt-median", {
      ageDays: 30,
      raw: { min: 10_000, median: 10_000, max: 30_001 },
    }),
  ]);
  assert.equal(freshPenalisedTail.headlinePence, 10_000, "quality 0.6 remains fallback-eligible");

  const agedPenalisedTail = reconcileComps(GRADED_QUERY, [
    exactCandidate(GRADED_QUERY, "pt-median", {
      ageDays: 31,
      raw: { min: 10_000, median: 10_000, max: 30_001 },
    }),
  ]);
  assert.equal(agedPenalisedTail.headlinePence, null, "quality 0.6 × 0.7 is below the strict boundary");
});

test("pt-smart is never an indicative fallback, including above and at the 0.5 quality boundary", () => {
  const otherwiseClean = reconcileComps(RAW_QUERY, [
    exactCandidate(RAW_QUERY, "pt-smart", {
      raw: { min: 5_000, median: 10_000, max: 20_000 },
    }),
  ]);
  assert.equal(otherwiseClean.headlinePence, null);
  assert.equal(otherwiseClean.chosenSource, undefined);

  const exactlyHalfQuality = reconcileComps(RAW_QUERY, [
    exactCandidate(RAW_QUERY, "pt-smart", { raw: undefined }),
  ]);
  assert.equal(exactlyHalfQuality.headlinePence, null);
  assert.equal(exactlyHalfQuality.chosenSource, undefined);
});

test("corroboration-only and hard-excluded evidence cannot become a fallback headline", () => {
  const rejected: Array<{ label: string; query: ReconQuery; candidate: ReconCandidate }> = [
    {
      label: "thin owned sales",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "owned-sales", { n: 2 }),
    },
    {
      label: "thin checked comps",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "checked-comps", { n: 1 }),
    },
    {
      label: "wide checked comps",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "checked-comps", {
        raw: { min: 1_000, median: 4_000, max: 4_001 },
      }),
    },
    {
      label: "unscoped RAW eBay condition",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "ebay-insights", { conditionMatched: false }),
    },
    {
      label: "invalid zero value",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "pt-median", { valuePence: 0 }),
    },
    {
      label: "invalid oversized value",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "pt-median", { valuePence: 100_000_001 }),
    },
    {
      label: "invalid zero sample",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "pt-median", { n: 0 }),
    },
    {
      label: "stale checked comps",
      query: RAW_QUERY,
      candidate: exactCandidate(RAW_QUERY, "checked-comps", { n: 2, ageDays: 91 }),
    },
    {
      label: "vintage catalog evidence",
      query: { ...RAW_QUERY, isVintage: true },
      candidate: exactCandidate(RAW_QUERY, "tcg-market"),
    },
  ];

  for (const entry of rejected) {
    const result = reconcileComps(entry.query, [entry.candidate]);
    assert.equal(result.headlinePence, null, entry.label);
    assert.equal(result.chosenSource, undefined, entry.label);
  }
});

test("adding rejected catalog evidence cannot unlock or replace a safe thin fallback", () => {
  const safeThin = exactCandidate(RAW_QUERY, "pt-median", {
    valuePence: 4_000,
    ageDays: 2,
  });
  const baseline = reconcileComps(RAW_QUERY, [safeThin]);
  assert.equal(baseline.headlinePence, 4_000);
  assert.equal(baseline.chosenSource, "pt-median");

  const withExpiredCatalog = reconcileComps(RAW_QUERY, [
    safeThin,
    exactCandidate(RAW_QUERY, "tcg-market", {
      valuePence: 9_000,
      ageDays: 366,
    }),
  ]);
  assert.equal(withExpiredCatalog.headlinePence, baseline.headlinePence);
  assert.equal(withExpiredCatalog.chosenSource, baseline.chosenSource);

  const withUnmatchedCatalog = reconcileComps(RAW_QUERY, [
    safeThin,
    exactCandidate(RAW_QUERY, "tcg-market", {
      valuePence: 9_000,
      matchedSetId: undefined,
    }),
  ]);
  assert.equal(withUnmatchedCatalog.headlinePence, baseline.headlinePence);
  assert.equal(withUnmatchedCatalog.chosenSource, baseline.chosenSource);
});

test(`reconciler deterministic property stress (${CASE_COUNT} cases, seed ${formatSeed(SEED)})`, () => {
  const random = mulberry32(SEED);

  for (let caseIndex = 0; caseIndex < CASE_COUNT; caseIndex += 1) {
    const query = generateQuery(random);
    const candidates = generateCandidates(random, query);
    const queryBefore = structuredClone(query);
    const candidatesBefore = structuredClone(candidates);
    let result: ReconResult | undefined;

    try {
      result = reconcileComps(query, candidates);
      const repeated = reconcileComps(query, candidates);
      assert.deepEqual(repeated, result, "same input must produce the same output");
      assert.deepEqual(query, queryBefore, "query input was mutated");
      assert.deepEqual(candidates, candidatesBefore, "candidate input was mutated");
      assertJsonSafeAndFinite(result);
      assertResultShape(result);

      const fallbackReason = result.reasons.find((reason) =>
        reason.startsWith("indicative-fallback:"),
      );
      if (fallbackReason) {
        assert.equal(result.confidence, "low", "fallback confidence must be low");
        assert.equal(result.manualCheck, true, "fallback must require manual review");
        const chosenSource = result.chosenSource;
        assert.ok(chosenSource, "fallback must name its source");
        const chosen = candidates.find((candidate) => candidate.source === chosenSource);
        assert.ok(chosen, "fallback source must refer to an input candidate");
        assert.equal(
          isPolicyEligibleFallback(query, chosen),
          true,
          `ineligible fallback selected from ${chosen.source}`,
        );
      }

      if (result.headlinePence != null) {
        const chosenSource = result.chosenSource;
        assert.ok(chosenSource, "headline must name its source");
        const chosen = candidates.find((candidate) => candidate.source === chosenSource);
        assert.ok(chosen, "chosen source must refer to an input candidate");
        assert.equal(
          isLocallyHardExcluded(query, chosen),
          false,
          `hard-excluded ${chosen.source} became the headline`,
        );
      }
    } catch (error) {
      throw new Error(
        [
          `Reconciler property failure at case ${caseIndex} with COMP_RECON_SEED=${formatSeed(SEED)}`,
          `query=${diagnosticJson(query)}`,
          `candidates=${diagnosticJson(candidates)}`,
          `result=${diagnosticJson(result)}`,
          error instanceof Error ? error.stack ?? error.message : String(error),
        ].join("\n"),
      );
    }
  }
});

type Random = () => number;

function generateQuery(random: Random): ReconQuery {
  const identity = pick(random, [
    { setId: "swsh7", cardNumber: "94/203" },
    { setId: "sv3pt5", cardNumber: "199/165" },
    { setId: "me4", cardNumber: "96/86" },
    { setId: "svp", cardNumber: "208" },
  ]);
  return {
    ...identity,
    language: chance(random, 0.85) ? "EN" : "JP",
    gradeBucket: pick(random, ["RAW", "PSA_9", "PSA_10", "CGC_10", "BGS_9_5", "ACE_10"]),
    isVintage: chance(random, 0.12),
    ambiguous: chance(random, 0.15),
  };
}

function generateCandidates(random: Random, query: ReconQuery): ReconCandidate[] {
  const available = query.gradeBucket === "RAW"
    ? [...SOURCES]
    : SOURCES.filter((source) => source !== "tcg-market");
  shuffleInPlace(random, available);
  const count = 1 + randomInt(random, available.length);
  return available.slice(0, count).map((source) => generateCandidate(random, query, source));
}

function generateCandidate(random: Random, query: ReconQuery, source: ReconSource): ReconCandidate {
  const valuePence = boundaryNumber(random, [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    0,
    1,
    99,
    100,
    999,
    1_000,
    9_999,
    10_000,
    49_999,
    50_000,
    99_999_999,
    100_000_000,
    100_000_001,
  ], () => 100 + randomInt(random, 2_000_000));
  const n = boundaryNumber(random, [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    0,
    1,
    2,
    3,
    5,
    10,
    29,
    30,
    49,
    50,
    51,
    499,
    500,
    501,
    5_000,
  ], () => 1 + randomInt(random, 10_000));
  const ageDays = chance(random, 0.06)
    ? undefined
    : boundaryNumber(random, [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        -1,
        0,
        1,
        30,
        31,
        45,
        46,
        89,
        90,
        91,
        120,
        121,
        179,
        180,
        181,
        200,
        364,
        365,
        366,
      ], () => randomInt(random, 450));
  const candidate: ReconCandidate = {
    source,
    valuePence,
    n,
    ageDays,
    region: pick(random, ["UK", "EU", "US"] as const),
    matchedSetId: query.setId,
    matchedCardNumber: equivalentCardNumber(query.cardNumber),
    matchedLanguage: query.language,
    trendPct: chance(random, 0.35)
      ? pick(random, [-500, -101, -100, -25, 0, 25, 100, 101, 500])
      : null,
    trendWindowDays: pick(random, [7, 14, 30, 90, 91, 180]),
    trendBucketDaysApart: pick(random, [1, 13, 14, 30, 90]),
    evidenceFamily: chance(random, 0.25) ? pick(random, ["sold", "catalog", "provider"]) : undefined,
    convertedFromNonGbp: chance(random, 0.2),
    fxAgeDays: pick(random, [0, 1, 3, 4, 10]),
  };
  applyRandomIdentity(random, candidate);

  const validBase = Number.isFinite(valuePence) && valuePence > 0
    ? Math.min(Math.round(valuePence), 100_000_000)
    : 10_000;
  if (chance(random, 0.6) || source === "pt-smart") {
    candidate.raw = generateRawEvidence(random, validBase);
  }
  if (source === "pt-smart" && candidate.raw && chance(random, 0.2)) {
    const mode = randomInt(random, 3);
    if (mode === 0) candidate.raw.max = Math.max(1, validBase - 1);
    if (mode === 1) candidate.raw.min = validBase + 1;
    if (mode === 2) candidate.raw.median = Math.max(1, Math.floor(validBase / 3));
  }
  if (source === "tcg-market") {
    const useTrendOverride = chance(random, 0.25);
    candidate.fields = useTrendOverride
      ? { trendPrice: validBase * 2, avg30: validBase, avg7: Math.round(validBase * 1.1), low: Math.round(validBase * 0.8) }
      : { trendPrice: validBase, avg30: validBase, avg7: validBase, low: Math.round(validBase * 0.8) };
  }
  if (source === "poketrace") {
    candidate.candidateHasGradeScopedData =
      query.gradeBucket === "RAW" ? chance(random, 0.5) : chance(random, 0.7);
  }
  if (source === "ebay-insights") candidate.conditionMatched = chance(random, 0.65);
  if (source === "checked-comps") {
    candidate.conditionMatched = chance(random, 0.65);
    candidate.traceableUkSales = pick(random, [0, 1, 2, 3, 10]);
  }
  if (Number.isFinite(n) && n > 0 && chance(random, 0.2)) {
    candidate.sampleSizeApproximate = true;
  }
  return candidate;
}

function generateRawEvidence(random: Random, valuePence: number): NonNullable<ReconCandidate["raw"]> {
  const ratio = pick(random, [1, 2, 3, 3.0001, 4, 4.0001, 8, 8.0001, 12]);
  const min = Math.max(1, valuePence);
  return {
    min,
    median: valuePence,
    max: Math.max(min, Math.round(min * ratio)),
    count: pick(random, [1, 2, 3, 10, 50, 500]),
  };
}

function applyRandomIdentity(random: Random, candidate: ReconCandidate): void {
  const mode = randomInt(random, 12);
  if (mode <= 6) return;
  if (mode === 7) candidate.matchedSetId = "wrong-set";
  if (mode === 8) candidate.matchedCardNumber = "999/999";
  if (mode === 9) candidate.matchedLanguage = candidate.matchedLanguage === "EN" ? "JP" : "EN";
  if (mode === 10) candidate.matchedSetId = undefined;
  if (mode === 11) candidate.matchedCardNumber = undefined;
}

function isPolicyEligibleFallback(query: ReconQuery, candidate: ReconCandidate): boolean {
  if (isLocallyHardExcluded(query, candidate) || !matchesQueryExactly(query, candidate)) {
    return false;
  }
  const state = normalizedCandidate(candidate);
  if (candidate.source === "tcg-market") {
    return (
      query.gradeBucket === "RAW" &&
      query.isVintage !== true &&
      Number.isFinite(state.ageDays) &&
      state.ageDays <= 365
    );
  }
  if (candidate.source === "pt-smart") return false;
  return (
    Number.isFinite(state.ageDays) &&
    state.ageDays <= 90 &&
    !isCorroborationOnly(query, candidate) &&
    qualityFactor(query, candidate) > 0.5
  );
}

function isLocallyHardExcluded(query: ReconQuery, candidate: ReconCandidate): boolean {
  const state = normalizedCandidate(candidate);
  if (
    !Number.isFinite(state.valuePence) ||
    !Number.isFinite(state.n) ||
    state.valuePence <= 0 ||
    state.valuePence > 100_000_000 ||
    state.n <= 0
  ) return true;
  if (
    (query.setId && candidate.matchedSetId && candidate.matchedSetId !== query.setId) ||
    (query.cardNumber && candidate.matchedCardNumber &&
      !collectorNumbersEquivalent(candidate.matchedCardNumber, query.cardNumber)) ||
    (query.language && candidate.matchedLanguage && candidate.matchedLanguage !== query.language)
  ) return true;
  if (
    query.gradeBucket !== "RAW" &&
    candidate.source === "poketrace" &&
    candidate.candidateHasGradeScopedData !== true
  ) return true;
  if (candidate.source === "pt-smart") {
    const stats = candidate.raw;
    if (stats?.max != null && state.valuePence > stats.max) return true;
    if (stats?.min != null && state.valuePence < stats.min) return true;
    if (stats?.median && state.valuePence / stats.median > 2) return true;
  }
  if (candidate.source === "tcg-market" && query.gradeBucket === "RAW" && query.isVintage) {
    return true;
  }
  return candidate.source === "checked-comps" && state.ageDays > 90;
}

function isCorroborationOnly(query: ReconQuery, candidate: ReconCandidate): boolean {
  const state = normalizedCandidate(candidate);
  if (state.ageDays > 180) return true;
  if (candidate.source === "owned-sales" && (state.n < 3 || state.ageDays > 120)) return true;
  if (candidate.source === "checked-comps" && state.n < 2) return true;
  if (candidate.source === "checked-comps" && rawSpread(candidate.raw) > 4) return true;
  return (
    candidate.source === "ebay-insights" &&
    query.gradeBucket === "RAW" &&
    candidate.conditionMatched !== true
  );
}

function qualityFactor(query: ReconQuery, candidate: ReconCandidate): number {
  const state = normalizedCandidate(candidate);
  let factor = 1;
  if (
    query.gradeBucket === "RAW" &&
    (candidate.source === "pt-smart" || candidate.source === "pt-median") &&
    rawSpread(candidate.raw) > 8
  ) factor *= 0.3;
  if (query.gradeBucket !== "RAW" && gradedTailRatio(candidate.raw, state.valuePence) > 3) {
    factor *= 0.6;
  }
  if (state.ageDays > 30 && state.ageDays <= 90) factor *= 0.7;
  if (state.ageDays > 90 && state.ageDays <= 180) factor *= 0.4;
  if (candidate.source === "pt-smart" && !candidate.raw) factor *= 0.5;
  return factor;
}

function normalizedCandidate(candidate: ReconCandidate): {
  valuePence: number;
  n: number;
  ageDays: number;
} {
  const reportedN = Math.round(candidate.n);
  return {
    valuePence: Math.round(candidate.valuePence),
    n: candidate.sampleSizeApproximate ? Math.min(reportedN, 50) : reportedN,
    ageDays:
      typeof candidate.ageDays === "number" &&
      Number.isFinite(candidate.ageDays) &&
      candidate.ageDays >= 0
        ? candidate.ageDays
        : Number.POSITIVE_INFINITY,
  };
}

function matchesQueryExactly(query: ReconQuery, candidate: ReconCandidate): boolean {
  if (!query.setId && !query.cardNumber) return false;
  if (query.setId && candidate.matchedSetId !== query.setId) return false;
  if (
    query.cardNumber &&
    (!candidate.matchedCardNumber ||
      !collectorNumbersEquivalent(candidate.matchedCardNumber, query.cardNumber))
  ) return false;
  return !query.language || candidate.matchedLanguage === query.language;
}

function assertResultShape(result: ReconResult): void {
  assert.ok(result.reasons.length > 0);
  assert.ok(result.reasons.every((reason) => typeof reason === "string" && reason.length > 0));
  if (result.headlinePence == null) {
    assert.equal(result.chosenSource, undefined);
    assert.equal(result.selection, undefined);
    assert.equal(result.trendPct, null);
    return;
  }
  assert.ok(Number.isInteger(result.headlinePence));
  assert.ok(result.headlinePence > 0 && result.headlinePence <= 100_000_000);
  assert.ok(result.chosenSource);
  assert.ok(result.selection);
  assert.ok(result.selection.sampleSize > 0);
  assert.ok(result.selection.ageDays >= 0);
  assert.ok(result.selection.lowPence <= result.selection.highPence);
  assert.ok(result.selection.crossSourceLowPence <= result.selection.crossSourceHighPence);
  assert.equal(
    result.selection.spreadPence,
    result.selection.crossSourceHighPence - result.selection.crossSourceLowPence,
  );
}

function assertJsonSafeAndFinite(value: unknown): void {
  assertFiniteNumbers(value, "$");
  const encoded = JSON.stringify(value);
  assert.notEqual(encoded, undefined);
  assert.deepEqual(JSON.parse(encoded), value);
}

function assertFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite, received ${String(value)}`);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteNumbers(entry, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) assertFiniteNumbers(entry, `${path}.${key}`);
  }
}

function rawSpread(raw: ReconCandidate["raw"]): number {
  if (!raw?.min || !raw.max || raw.min <= 0) return 1;
  return raw.max / raw.min;
}

function gradedTailRatio(raw: ReconCandidate["raw"], valuePence: number): number {
  if (!raw?.min || !raw.max || raw.min <= 0 || raw.max <= 0 || valuePence <= 0) return 1;
  return Math.max(raw.max / valuePence, valuePence / raw.min);
}

function equivalentCardNumber(cardNumber: string | undefined): string | undefined {
  return cardNumber === "96/86" ? "096/086" : cardNumber;
}

function boundaryNumber(random: Random, boundaries: number[], fallback: () => number): number {
  return chance(random, 0.72) ? pick(random, boundaries) : fallback();
}

function randomInt(random: Random, exclusiveMax: number): number {
  return Math.floor(random() * exclusiveMax);
}

function chance(random: Random, probability: number): boolean {
  return random() < probability;
}

function pick<T>(random: Random, values: readonly T[]): T {
  return values[randomInt(random, values.length)]!;
}

function shuffleInPlace<T>(random: Random, values: T[]): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = randomInt(random, index + 1);
    [values[index], values[other]] = [values[other]!, values[index]!];
  }
}

function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function parseCaseCount(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_CASE_COUNT;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_CASE_COUNT) {
    throw new Error(`COMP_RECON_CASES must be an integer from 1 to ${MAX_CASE_COUNT}; received ${raw}`);
  }
  return parsed;
}

function parseSeed(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_SEED;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric >>> 0;
  let hash = 0x811c9dc5;
  for (const character of raw) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function formatSeed(seed: number): string {
  return `0x${(seed >>> 0).toString(16).padStart(8, "0")}`;
}

function diagnosticJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === "number" && !Number.isFinite(entry) ? String(entry) : entry);
}
