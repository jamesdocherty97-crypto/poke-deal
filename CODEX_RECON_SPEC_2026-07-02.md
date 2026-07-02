# Comp Reconciliation Rewrite — Implementation Brief (2026-07-02)

**For: Codex. Self-contained — no other context needed beyond this file and CODEX_LIVE_QA_2026-07-02.md (evidence).**

Replace the current headline-picking logic in the comps pipeline (currently `pickRawHeadline` / `mapCardAggregateToComp` in `compService.ts` and related) with the pure, deterministic reconciler specified below. Do NOT change the source-adapter contract. The reconciler must be a pure function: `(query, candidates[]) → { headlinePence, confidence: 'high'|'medium'|'low', manualCheck: boolean, reasons: string[] }`, unit-testable with no network/DB.

## Design principles
1. **Internal consistency is a gate.** A derived figure contradicting its own raw data (smart price > its own max sale; trendPrice ≫ its own avg30) is fabricated — hard-exclude, never average in.
2. **Sample size buys weight logarithmically; identity is a gate, not a weight.** n=24,491 on the wrong card is worth zero.
3. **The headline is one source's number, never a blend.** Disagreement is expressed via confidence + manualCheck, not averaged away.

## Inputs
```
query: { setId, cardNumber?, language, gradeBucket (RAW|PSA10|...), isVintage (set pre-2003), ambiguous }
  ambiguous = true if cardNumber absent AND >1 catalog card in the set matches the name
              (fix the current guard: it only fires on score ties — see QA item C3)
candidate: { source, valuePence, n, ageDays (∞ if unknown), region (UK|EU|US),
             matchedSetId, matchedCardNumber, matchedLanguage,
             raw {min,max,median,count}?      // price-tracker only
             fields {trendPrice,avg30,avg7,low}?  // tcg-market only
             trendPct? }
```
Sources: `owned-sales`, `ebay-insights` (currently disabled; wire the tier now), `pt-smart`, `pt-median`, `tcg-market`, `poketrace`.

## Phase A — hard eligibility gates (record every exclusion with a reason string)
- **A1 identity:** matchedSetId ≠ query.setId, or matchedCardNumber ≠ query.cardNumber (when given), or language mismatch → EXCLUDE. (Fixes PokeTrace matching Celebrations 4/102 for Base 4/102 — QA H1. Apply in reconciler even if the adapter also gets a guard.)
- **A2 validity:** valuePence ≤ 0, > 100_000_000, or n ≤ 0 → EXCLUDE.
- **A3 smart-price sanity (pt-smart):** if raw stats present and (value > raw.max or value < raw.min) → EXCLUDE(`smart-out-of-band`). If value/raw.median > 2.0 → EXCLUDE(`smart-diverges-from-own-median`). (Fixes QA C2: $147.50 smart vs max sale $114.99.)
- **A4 tcg-market internal consistency:** default field = trendPrice; if avg30 present and trendPrice/avg30 > 1.5 → use avg30 instead (QA H3: 3576/2075=1.72). If query.isVintage AND gradeBucket=RAW → EXCLUDE tcg-market entirely (Cardmarket vintage mixes 1st-ed/shadowless/graded).
- **A5 dominant-source outlier:** let D = largest-n survivor; if D.n ≥ 50×c.n AND D.n ≥ 500 AND max/min ratio of (c.value, D.value) > 3.0 → EXCLUDE c. (Backstop for QA C1: n=11 smart £116 vs n=5,002 baseline £8.80.)
- **A6 staleness:** ageDays > 180 → demote to CORROBORATION-ONLY (cannot headline; still counts for agreement/disagreement).
- **A7 thin owned-sales:** owned-sales with n < 3 or ageDays > 120 → CORROBORATION-ONLY.

## Phase B — multiplicative penalties on surviving candidates
- **B1** RAW query, price-tracker bucket with raw.max/raw.min > 8.0 → ×0.3 (graded contamination; Moonbreon £354–£3,937 = 11×).
- **B2** graded query, bucket spread > 2.5 → ×0.5.
- **B3** staleness: ≤30d ×1.0; ≤90d ×0.7; ≤180d ×0.4.
- **B4** region: UK ×1.0; EU ×0.9; US ×0.8.
- **B5** pt-smart with raw stats absent → ×0.5.

## Phase C — weight & headline
```
tierWeight: owned-sales 1.00 | ebay-insights 0.95 | pt-smart 0.75
          | pt-median 0.70   | tcg-market 0.65    | poketrace 0.60
sizeFactor(n) = min(1, log10(n+1)/3)          // n=10→0.35, n=100→0.67, n≥1000→1.0
weight = tierWeight × sizeFactor × product(penalties)
ELIGIBLE = survivors with weight ≥ 0.10, not corroboration-only
headline = value of argmax(weight); ties → tier order, then larger n
if ELIGIBLE empty: headline = best corroboration-only value (else null); confidence=low; manualCheck=true; stop.
```

## Phase D — trend suppression
If |trendPct| > 100 (over ≤90-day window) → emit trend as null (never a fake +297.9% — QA H2) and record a data-quality caution used by cap C4 below. Also: only emit any trendPct when the underlying history has ≥2 buckets ≥14 days apart.

## Confidence & manual-check
```
W = weight(chosen)
PEERS = eligible with weight ≥ 0.3×W (incl. chosen)
spreadPeer = max/min value over PEERS; spreadAll = over all eligible

Caps (any → confidence ≤ medium):
  C1 query.ambiguous
  C2 graded query with only one eligible source
  C3 penalty(chosen) < 1.0
  C4 impossible trend suppressed on chosen

confidence = LOW  if W < 0.25, or spreadPeer > 1.4, or every eligible penalty < 0.5
           = HIGH if W ≥ 0.45 and (|PEERS|=1 or spreadPeer ≤ 1.25) and no cap
           = MEDIUM otherwise

manualCheck = confidence==low
           OR spreadAll > 1.4
           OR query.ambiguous
           OR penalty(chosen) ≤ 0.5
           OR ≥2 Phase-A hard exclusions occurred
           OR headline came from corroboration-only fallback
           OR (owned-sales corroboration deviates >40% from headline)
```
Return `reasons[]` naming every exclusion/penalty/cap — surface in the evidence panel as the "why check manually" tooltip.

## Acceptance oracles (must all pass as unit tests; pence)
| # | Input sketch | Expected |
|---|---|---|
| T1 | pt-smart 11614 n=11 raw{max 9074}; poketrace 880 n=5002; ambiguous | 880, medium, true |
| T2 | pt-smart 11614 n=11 raw{max 12000} (in-band); poketrace 880 n=5002 | 880, *, true (A5 fires) |
| T3 | tcg trend 357600 avg30 207500 vintage RAW; poketrace wrong-set; pt-median 25000 n=40 | 25000, medium, true |
| T4 | pt 106200 n=251 in-band, PSA10 only source, trendPct +297.9 | 106200, medium, false, trend=null |
| T5 | poketrace 1282 n=24491, unambiguous, alone | 1282, high, false |
| T6 | pt-smart 120900 n=93 raw{35400–393700}; tcg 135000 age 210d; poketrace 179200 n=365 | 179200, medium, true |
| T7 | ebay-insights 8000 n=200 UK vs poketrace 12000 n=8000 | 8000, low, true |
| T8 | only tcg 50000 age 200d | 50000, low, true |
| T9 | owned 30000 n=4 age 20d; poketrace 22000 n=3000 | 30000, medium, false |
| T10 | no candidates | null, low, true |
| T11 | two sources agreeing within 5%, both penalty <0.5 | value, low, true |
| T12 | ebay-insights 10000 n=60 UK + poketrace 9500 n=5000 | 10000, high, false |

Also add a **graded-query guard**: poketrace baseline is a RAW price — for graded queries treat it as identity-mismatched (A1) unless the adapter explicitly returns grade-scoped data.

## Secondary items from the same QA pass (do after the reconciler)
1. **C3 ambiguity guard**: in `/api/comps`, when name+set given with no number and catalog has >1 match, set `ambiguous:true` + populate `alternatives[]` (Umbreon/Evolving Skies must return 5 candidates, not silently resolve to V 94/203).
2. **M1 staleness surfacing**: show `asOf` age on each evidence row.
3. **M2 graded flakiness**: first call to PSA-10 comps returned empty then succeeded on retry — add one retry with backoff on the PPT `salesByGrade` call and a loading/retry state in the UI.
4. Keep the working paths intact: numbered identity resolution (sv3pt5-199, swsh7-215, svp-208) and the Victini/promo flow are correct — do not regress; run the existing 328-test suite plus the new oracles.
