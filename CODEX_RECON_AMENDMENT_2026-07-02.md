# Reconciler Amendment 1 — quality vs region penalties, tail-based graded contamination

**For: Codex. Self-contained. This is a DESIGNED amendment to CODEX_RECON_SPEC_2026-07-02.md, authorized by the spec author — it resolves the Phase-A verifier failure on Charizard ex 151 PSA 10 (prod returned low/manualCheck; correct is medium/false). Do this BEFORE committing scripts/verify-prod.mts, then resume CODEX_GOAL_2026-07-02B.md Phase B.**

## Root cause (for the commit message)
Penalty stacking conflated two different things: data-quality damage (contamination/staleness/unverifiable) and region relevance (US ×0.8). A clean n=251 US graded median stacked ×0.5 (bucket spread) × ×0.8 (region) = 0.4, tripping both the W<0.25 LOW floor and the "all sources damaged" LOW rule. Additionally, the graded-bucket spread test (max/min > 2.5) cannot distinguish mixed-grade contamination from legitimate price movement over the bucket's time window — volatile liquid cards always exceed it.

## Change R1 — split penalty classes
- `qualityPenalty(c)` = product of B1 (raw contamination), B2 (graded contamination), B3 (staleness), B5 (unverifiable smart).
- `regionFactor(c)` = B4 (UK 1.0 / EU 0.9 / US 0.8).
- `weight = tierWeight × sizeFactor × qualityPenalty × regionFactor` (unchanged numerically).
- Rules that test for DAMAGE now use `qualityPenalty` ONLY:
  - LOW rule "every eligible penalty < 0.5" → "every eligible qualityPenalty < 0.5".
  - Cap C3 → applies when `qualityPenalty(chosen) < 1.0` (region alone no longer caps... EXCEPTION: keep C3 also applying when regionFactor < 1.0 AND the query is graded AND no UK/EU source exists — no, DROP this exception; see R4 note).
  - manualCheck M4 → `qualityPenalty(chosen) ≤ 0.5`.
- Region continues to affect WEIGHT (source selection and the W thresholds) — it just no longer brands a source as damaged.

## Change R2 — graded contamination test becomes tail-based
Replace B2 (`graded query, bucket max/min > 2.5 → ×0.5`) with:
```
graded query, bucket stats present:
  tailRatio = max(raw.max / value, value / raw.min)    // value = the bucket median
  if tailRatio > 3.0 → qualityPenalty ×0.6
```
Rationale: mixed-grade pollution shows as an asymmetric tail relative to the median; symmetric spread around the median is price movement over time. Leave B1 (RAW, max/min > 8 → ×0.3) exactly as-is — verify Moonbreon still trips it (it also trips the tail test at 3937/1209 = 3.26, but B1 is the raw rule and stays authoritative for RAW).

## Change R3 — C3 cap wording
C3 now reads: confidence ≤ medium when `qualityPenalty(chosen) < 1.0`. A pure-region-discounted source CAN reach high (this is what already lets Victini/poketrace n=24k be high; make it explicit rather than incidental).

## R4 — explicitly unchanged
W thresholds (0.25/0.45), spread thresholds (1.25/1.4), tier weights, sizeFactor, B1/B3/B5, all manualCheck rules other than M4, cap C2 (single-source graded ≤ medium — this still caps Charizard ex at medium, which is correct).

## Expected outcome on the live case (hand-check before writing tests)
Charizard ex PSA 10, pt-median n=251, US, bucket spread symmetric-ish around £1,062:
- If tailRatio ≤ 3.0: qualityPenalty = 1.0, W = 0.70 × 0.80 × 1.0 × 0.8 = 0.448 → not LOW; caps C2 + C4 (trend suppressed) → **medium**; M4 no longer fires → **manualCheck false**. Reasons should retain `trend-suppressed` and gain nothing spurious.
- If the real bucket data DOES show tailRatio > 3.0 (check the actual prod payload min/max before assuming): qualityPenalty 0.6 → W = 0.269 → still medium via caps, manualCheck false (0.6 > 0.5). Either branch satisfies the verifier.

## Test changes
1. Keep T4 (synthetic, no bucket stats) as-is — must still pass.
2. Add **T4b** using the REAL production payload values for Charizard ex 151 PSA 10 (fetch once, embed as fixture): expected medium, manualCheck false, trendPct null.
3. Fix T11's inputs so both sources carry qualityPenalty < 0.5 via staleness/contamination (not region) — expectation unchanged: low, true.
4. Add **T13**: graded bucket, symmetric spread max/min = 3.0 but tailRatio < 3.0 (e.g. min 500, median 1000, max 1500... note max/min=3 → tails 1.5/2.0) → NO contamination penalty.
5. Add **T14**: graded bucket with asymmetric tail (min 900, median 1000, max 3500 → tailRatio 3.5) → ×0.6 applied, reason recorded.
6. Re-run ALL existing oracles + live fixtures. The Moonbreon fixture (manualCheck true) and Victini (high/false) must be unchanged. If any OTHER fixture's expectation shifts under R1–R3, STOP and report with the before/after — do not adjust expectations to make tests pass.

## Sequencing
1. Implement R1–R3 + tests locally; all gates green.
2. Update `scripts/verify-prod.mts` Charizard PSA 10 assertion to: confidence medium, manualCheck false, trend null.
3. Commit (amendment + verifier script + package.json), push, confirm deploy.
4. Run `npm run verify:prod` — all five must PASS. Then resume CODEX_GOAL_2026-07-02B.md from Phase B.
