# Reconciler Amendment 3 — red-team adjudication rulings (authorized by the design layer)

**For: Codex. Implements the design-layer verdicts on docs/REDTEAM_2026-07.md. These are manual-check/eligibility rules ONLY — tier weights, size factors, and confidence thresholds unchanged. Each rule gets unit oracles + rerun of the relevant red-team fixture proving the verdict flips. Gates: npm test, tsc, build, deploy, verify:prod 5/5, red-team suite rerun with updated verdict table appended to docs/REDTEAM_2026-07.md.**

## Ratifications (record-keeping, no new code unless stated)
- 38a950b (raw PokeTrace sold-aggregate preference, ≥30 sales, 1.2× inflation guard): RATIFIED as within-adapter value selection.
- c95d8be (agreeing-signal n boost, max-not-sum, ≤1.15 agreement): RATIFIED **with condition** — when the boost changes n, append reason `n-boosted-by-agreeing-signals` to the reconciliation reasons so the receipt discloses it. Implement this condition in this goal.
- Process rule going forward: a "frozen" subsystem means STOP AND REPORT when a gate seems to require changing it — never fix-and-ship for later ratification.

## R3-1 — Stale consensus cannot auto-quote (kills red-team #3, tightens #4)
If the NEWEST eligible candidate's ageDays > 45, set manualCheck true with reason `stale-consensus` regardless of agreement or confidence. Rationale: unanimity between equally-old sources is shared staleness, not corroboration — a reprint crash walks straight through it. Oracle: three agreeing 60–70d sources → manualCheck true (deal calc refuses quote); same sources with one ≤45d → unchanged behaviour.

## R3-2 — Dominance exclusion cannot silence higher-trust sources (kills red-team #5)
The dominant-source outlier rule (A5) applies ONLY when the candidate's tierWeight ≤ the dominant source's tierWeight. A huge low-tier US baseline may never EXCLUDE owned-sales, checked-comps, or ebay-insights; instead the disagreement stands and flows into the spread/manual-check logic. Negative oracle: original case-1 behaviour preserved (thin pt-smart still excluded by huge poketrace); new oracle: 8-sale UK ebay-insights disagreeing 3× with huge US baseline → NOT excluded, manualCheck true.

## R3-3 — Grade-bleed cross-check (mitigates red-team #7)
For graded queries where the same provider's adjacent-grade aggregate is available (the grade ladder already fetches it): if the queried grade's median < the one-grade-lower median × 1.15, set manualCheck true with reason `grade-bleed-suspect`. A PSA 10 priced within 15% of PSA 9 is either a data leak or a market anomaly — both deserve eyes. Oracle: PSA10 median 1.05× PSA9 → flagged; 1.5× → not flagged; missing PSA9 data → no change.

## R3-4 — Aged FX discloses and flags on big money (mitigates red-team #6)
When the chosen candidate's value was converted from non-GBP AND the FX rate used is > 3 days old: append reason `fx-aged`, and if headline ≥ £500 set manualCheck true. Oracle: £1,000 USD-derived headline on 6-day FX → flagged; £80 card same FX → reason only, no flag; fresh FX → unchanged.

## R3-5 — UK disagreement is never silent (mitigates red-team #8)
When the chosen headline comes from a US-region source and any UK sold-based source (owned-sales, checked-comps, ebay-insights) with n ≥ 5 disagrees with it by > 15%, set manualCheck true with reason `uk-solds-disagree`. Headline selection unchanged — this surfaces the conflict instead of silently outweighing local truth. Oracle: US baseline headline + 8 UK solds at −25% → flagged with reason; UK solds within 10% → no flag.

## Accepted as designed (no change)
- Red-team #4 residual: 80-day checked comps may still headline at low confidence + manual check — the quote gate holds, and R3-1 further constrains it. Acceptable.
- Red-team #9/#2/#10/#1: SURVIVES verdicts confirmed correct behaviour; pin their fixtures as permanent regression tests if not already.

## Exit
Updated verdict table in docs/REDTEAM_2026-07.md (expected: 0 FAILS, ≤2 DEGRADED-accepted), the c95d8be disclosure reason implemented, all existing fixtures/oracles green, verify:prod 5/5.
