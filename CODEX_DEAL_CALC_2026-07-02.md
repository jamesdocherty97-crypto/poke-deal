# Deal Calculator ("What Should I Pay") — Implementation Brief (2026-07-02)

**For: Codex. Self-contained. Builds directly on the reconciler shipped per CODEX_RECON_SPEC_2026-07-02.md.**

Add a pure, deterministic buy-side calculator that converts a reconciled comp into actionable offers. Pure function, no network/DB, fully unit-tested. Then surface it in the comp result UI.

## Function contract
```
dealCalc(comp, settings, options) → {
  netProceedsPence,            // what a sale at headline actually banks
  maxCashOfferPence | null,    // null when the calc refuses to quote
  maxTradeOfferPence | null,
  expectedProfitPence | null,  // at maxCashOffer
  route: 'flip' | 'grade' | 'no-quote',
  gradeRoute?: { evPence, breakdown },   // present when grading EV computed
  reasons: string[]            // why haircuts/refusals applied — reuse the reconciler pattern
}

comp = reconciler output + inputs: { headlinePence, confidence, manualCheck, gradeBucket,
                                     sampleSizeOfChosen, gradedComps? (per-grade headline+confidence) }
```

## Settings (persisted, editable in a settings UI; these are DEFAULTS, never hardcode at call sites)
```
fees: { ebayFvfPct: 12.8, ebayFixedPence: 30, promotedPct: 2.0 (toggle),
        postagePence: tiered by value — e.g. <£20: 155 (large letter tracked),
        £20–£100: 270, >£100: 550 (tracked/insured) — make the tiers a table,
        materialsPence: 30 }
marginTargetPct: 20            // dealer's required profit on cost
confidenceHaircut: { high: 1.00, medium: 0.85, low: 0.70 }
liquidityHaircut: chosen-source n ≥ 100 → 1.00; 30–99 → 0.95; <30 → 0.85
tradePremiumPct: 10            // trade credit offers this much more than cash
grading: { costPence: 2500 per card (service tier table later), 
           gradeProbabilities: user-entered per card at calc time (e.g. PSA10 0.35 / PSA9 0.50 / PSA8 0.15) }
```

## Calculation
```
sellPrice   = headlinePence
netProceeds = sellPrice × (1 − fvf% − promoted%) − fixed − postage(sellPrice) − materials
adjusted    = netProceeds × confidenceHaircut × liquidityHaircut
maxCashOffer  = adjusted / (1 + marginTarget%)
maxTradeOffer = maxCashOffer × (1 + tradePremium%)
expectedProfit = adjusted − maxCashOffer
```
Round offers DOWN to sensible quoting units: nearest 50p under £20, nearest £1 under £100, nearest £5 above.

## Refusal rules (route = 'no-quote', offers = null)
- comp.manualCheck is true, OR confidence is low AND headline ≥ £100.
- headlinePence is null.
- Always include the reconciler's reasons[] so the dealer sees WHY there's no auto-offer.
(Low-confidence cheap cards still quote — the downside is capped; reasons must say "low confidence".)

## Grading EV route (only when query is RAW and gradedComps are available)
```
gradeEV = Σ p(grade) × gradedComp(grade).netProceeds − gradingCost − postageToGrader
```
- Only use gradedComp entries with confidence ≥ medium; if PSA10 comp is low-confidence, exclude the route.
- route = 'grade' when gradeEV > adjusted × 1.25 (grading must beat flipping by 25% to justify the wait/risk); else 'flip'. Show both numbers regardless.
- Probabilities are per-card user input at calc time (condition-dependent); default sliders at 0.30/0.50/0.20 for 10/9/≤8.

## UI
- In the comp receipt, under the headline: "Max cash offer £X · trade £Y" with the confidence chip, or the no-quote notice with reasons.
- Grade-vs-flip comparison row for RAW chase cards when graded comps exist.
- Settings screen for fees/margin/haircuts (a dealer tunes these per fair).

## Unit-test oracles (pence; settings = defaults above unless stated)
| # | Input | Expected |
|---|---|---|
| D1 | headline 10000, high conf, n=500, RAW | net = 10000×0.852−30−270−30 = 8190; maxCash = 8190/1.2 = 6825 → round → 6800; trade 7480→7400 (verify rounding rule) |
| D2 | same but medium conf | adjusted 8190×0.85=6961; maxCash 5801→5800 |
| D3 | manualCheck=true, headline 179200 | no-quote, offers null, reasons include reconciler reasons |
| D4 | low conf, headline 8000 (<£100) | quotes, reasons include "low confidence"; haircut 0.70 applied |
| D5 | low conf, headline 50000 | no-quote |
| D6 | headline null | no-quote |
| D7 | n=11 chosen source | liquidity 0.85 applied, reason recorded |
| D8 | RAW 30000 with PSA10 comp 106200 (medium), probs 0.35/0.50/0.15, grading cost 2500 | gradeEV computed from net proceeds per grade; route='grade' iff EV > flip-adjusted×1.25; assert both numbers and the route |
| D9 | promoted toggle off | fvf-only fee math |
| D10 | headline 1500 (sub-£20 postage tier) | postage 155 used; offer rounded to 50p |

Compute D1/D2/D8 expected values exactly in the test file (the table above shows the method; derive precise integers in code, don't copy blindly).

## Guardrails
- Do not modify the reconciler or adapter contracts; consume their output only.
- Keep all existing tests green (516+).
- Fee/postage tables are UK eBay as of mid-2026 — mark them clearly as settings defaults with a comment to review quarterly, not constants scattered in logic.
