# Live Comp QA — findings from production (2026-07-02)

Probed `https://poke-deal.vercel.app/api/comps` across a real basket (vintage RAW, modern chase RAW, graded, promo, ambiguous). The **identity/plumbing is good, but the headline number a dealer sees first can be wildly wrong on thin-sample cards** because reconciliation over-trusts Price Tracker's smart price. Fix the CRITICAL items before relying on this at a fair.

All prices GBP. "n" = sampleSize. Raw JSON evidence available on request.

## Basket results

| Card | Grade | Headline | Source (n) | Reality check | Verdict |
|---|---|---|---|---|---|
| Umbreon **V** — Evolving Skies (typed "Umbreon", no number) | RAW | **£116.14** | PPT smart (n=11) | PokeTrace baseline £8.80 (n=5,002). Card is ~£9–15. | ❌ ~13× too high **+ not flagged ambiguous** |
| Charizard — Base 4/102 | RAW | £257.87 | PPT smart (n=71) | Plausible, but evidence panel shows £3,576 (Cardmarket) & a wrong-card £153 | ⚠️ headline ok, evidence polluted |
| Umbreon VMAX 215/203 (Moonbreon) | RAW | £1,208.96 | PPT smart (n=93) | Raw bucket contaminated (£354–£3,937 range); Cardmarket data 7 months stale | ⚠️ likely graded-inflated |
| Charizard ex 151 199/165 | PSA 10 | £1,062.20 | PPT median (n=251) | Plausible; single source, no cross-check; **trend +297.9%** | ⚠️ headline ok, trend garbage, timed out once |
| Victini SVP 208 | RAW | £12.82 | PokeTrace (n=24,491) | Correct. | ✅ works well |

## CRITICAL — silent wrong numbers (can cause overpaying)

### C1. Reconciliation trusts a thin PPT smart price over a huge PokeTrace sample
`Umbreon` + `Evolving Skies`: headline **£116.14** from Price Tracker `smartMarketPrice` (n=**11**), while PokeTrace returns **£8.80** off n=**5,002** for the same card. Contrast Victini SVP 208, where PPT was absent and PokeTrace's 24k-sample £12.82 correctly won — **so the bug is specifically that a low-sample smart price outranks a far larger, cleaner baseline.** Root: `pickRawHeadline` in `compService.ts` prefers `chosenPriceSource === "smartMarketPrice"` unconditionally. Fix: sample-weight the pick — a smart price with n<~30 must not outrank a baseline with orders-of-magnitude more sales; blend or defer to the larger sample.

### C2. PPT smartMarketPrice can exceed the maximum real sale
Same card: `smartMarketPrice = $147.50` while the observed raw sales were median **$22.50**, max **$114.99** — the "smart" price is *above the highest actual sale*. The app trusts it blind. Guard in `mapCardAggregateToComp`: reject/deprioritise `smartMarketPrice` when it falls outside the observed [minPrice, maxPrice] or when `count` is below a floor; fall back to `medianPrice` or the larger-sample source.

### C3. Ambiguity guard is NOT firing for the canonical case
`name=Umbreon & set=Evolving Skies & (no number)` returns `ambiguous:false`, `alternatives:[]`, and silently resolves to Umbreon **V 94/203** — even though `/api/catalog/cards` returns 5 Evolving Skies Umbreons. This is the exact case the A4 work was built for, and it's not triggering in `/api/comps`. Re-check the trigger: it likely only fires when top candidates tie on score, but "Umbreon" resolves strongly to one V, so multi-match is never detected. Detect ambiguity on *name+set with no disambiguating number* when >1 catalog card shares that name+set.

## HIGH — misleading evidence / wrong sub-data

### H1. PokeTrace matches the wrong card by number, ignoring set
Base Charizard `4/102` → PokeTrace returns **"Celebrations: Classic Collection" 4/102** (a different, cheaper card that shares the number). The PokeTrace adapter isn't verifying set/`tcgApiId` against the request. Add the same set-context guard the other sources use before accepting a PokeTrace match.

### H2. trendPct is producing garbage
Charizard ex 151 PSA 10 shows **trendPct +297.9%**; Base Charizard tcg-market **+62.3%**; Umbreon V PokeTrace **+35.4%**. These aren't real market moves — the newly-added trend calc is miscomputing (likely a bad ratio over sparse history). Prefer `null` over a fake 298%. Cap/sanity-bound the derived %, and only emit it with sufficient history.

### H3. Cardmarket `trendPrice` surfaced as a wild-high baseline
Base Charizard raw: `pokemon-tcg-market` = **£3,576** (Cardmarket trendPrice €4,184) while the same card's Cardmarket avg30 is €2,427 and low €799. Picking `trendPrice` first on vintage yields a polluted outlier (Cardmarket vintage prices mix 1st-ed/shadowless/graded). Prefer `avg30`/`averageSellPrice` over `trendPrice` for the baseline, and down-weight when the card's own Cardmarket fields spread widely.

## MEDIUM — staleness & reliability

### M1. Stale catalog prices shown as current
Moonbreon's Cardmarket/TCGPlayer signals are dated **2025-11-18** (~7.5 months old) but presented without a staleness flag. Surface `asOf` age and down-weight stale signals in confidence.

### M2. Graded lookups are slow/flaky
`Charizard ex 151 PSA 10` returned an **empty response on the first call**, succeeded on retry. On mobile at a fair that's a failed comp. Investigate the graded timeout (PPT `salesByGrade` latency); add a retry/loading state.

## Positives (working well — don't regress)
- **Identity lock is solid**: Charizard ex→`sv3pt5-199`, Moonbreon→`swsh7-215`, Victini promo→`svp-208` (via tcgDex). Numbered lookups land correctly.
- **Promo path is excellent**: Victini SVP 208 → £12.82 off a 24k-sample PokeTrace baseline. This is the model for how it should feel.
- `sourcesDisagree` correctly fires on every messy case (Base Charizard, Moonbreon, Umbreon V).
- **A7 free-wins partly shipped**: `trendPct` now populated (needs H2 fix), the blended `prices` block is parsed, and an `ebay-marketplace-insights` source is scaffolded and correctly reports "not enabled" (matches ticket 260628-000019).
- Graded headline uses `medianPrice`, not the raw `$421` market price — correct separation.

## Fix order
1. **C1 + C2** together (reconciliation sample-weighting + smart-price sanity bound) — this is the one that shows £116 for a £9 card. Biggest money risk, small surgical change in `compService.ts` / `pokemonPriceTracker.ts`.
2. **C3** ambiguity trigger for name+set-without-number.
3. **H1** PokeTrace set verification.
4. **H2 + H3** trend sanity-bound + Cardmarket baseline field choice.
5. **M1 + M2** staleness flag + graded latency.

Re-run this exact basket after each fix; Umbreon V should drop to ~£9–15 with an ambiguity flag, and no source should show an impossible trend.
