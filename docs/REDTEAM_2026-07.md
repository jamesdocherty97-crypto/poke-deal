# Pricing Brain Red-Team — July 2026

Scope: executable attack fixtures in `src/lib/comps/redteamPricingBrain.attacks.ts` and `src/lib/comps/redteamPricingBrain.attacks.test.ts`.

Run directly with:

```bash
node --import tsx --test src/lib/comps/redteamPricingBrain.attacks.test.ts
```

This suite is intentionally excluded from `npm test`. It uses the real reconciler and deal calculator, but exists as design evidence rather than a production gate. Reconciler weights and thresholds were not changed.

## Verdict Table

| Rank | Attack | Verdict | Money at risk | Actual behaviour |
| --- | --- | --- | ---: | --- |
| 1 | Vintage raw single-provider confidence | SURVIVES | £900.00 | Low confidence + manual check; deal calc refuses a quote. |
| 2 | Shill-bid poisoning | SURVIVES | £400.00 | Chooses broader PokeTrace baseline, low confidence, manual check. |
| 3 | Reprint crash | FAILS | £100.00 | Three agreeing 60-70 day old sources still produce a medium-confidence auto quote. |
| 4 | Checked-comp staleness trap | DEGRADED | £80.00 | 80-day checked comps can headline, but low confidence/manual check blocks quote. |
| 5 | Dominant bad source suppresses a good UK source | FAILS | £80.00 | Huge wrong US source excludes smaller UK MI as a dominant-source outlier. |
| 6 | Currency shock | DEGRADED | £74.07 | Six-day stale FX can overstate a £1,000 USD-derived card by about £74 after an 8% move. |
| 7 | Grade bleed | FAILS | £40.00 | Clean-looking single-provider PSA 10 aggregate auto-quotes even if it is actually PSA 9 data. |
| 8 | UK small sample loses to huge US baseline | DEGRADED | £40.00 | Huge US baseline headlines over eight UK solds without manual check. |
| 9 | Owned-sales self-poisoning | SURVIVES | £30.00 | Owned firesale headline is low confidence/manual check, so no quote. |
| 10 | Deal-calc margin illusion | SURVIVES | £1.14 | Quote steps down across the £19.99/£20.00 postage boundary. |

## Notes for Design Layer

- Biggest true failures are not parser bugs; they are evidence freshness/source dominance problems.
- The reconciler currently treats agreeing stale sources inside 90 days as enough to auto-quote. That is dangerous when reprints/crashes happen suddenly.
- The dominant-source outlier rule can exclude a smaller but more UK-relevant source when a huge broad source is wrong.
- Single-provider graded comps still need stronger grade-contamination defences; the app cannot see PSA 9 leakage if provider metadata looks clean.
- No fixes were applied in this goal.

## Raw Outputs

```json
[
  {
    "id": "A1",
    "verdict": "SURVIVES",
    "moneyAtRiskPence": 40000,
    "reconciler": { "headlinePence": 10000, "confidence": "low", "manualCheck": true, "chosenSource": "poketrace" },
    "dealCalc": { "route": "no-quote", "maxCashOfferPence": null }
  },
  {
    "id": "A2",
    "verdict": "FAILS",
    "moneyAtRiskPence": 10000,
    "reconciler": { "headlinePence": 20000, "confidence": "medium", "manualCheck": false, "chosenSource": "pt-smart" },
    "dealCalc": { "route": "flip", "maxCashOfferPence": 11500 }
  },
  {
    "id": "A3",
    "verdict": "DEGRADED",
    "moneyAtRiskPence": 8000,
    "reconciler": { "headlinePence": 20000, "confidence": "low", "manualCheck": true, "chosenSource": "checked-comps" },
    "dealCalc": { "route": "no-quote", "maxCashOfferPence": null }
  },
  {
    "id": "A4",
    "verdict": "FAILS",
    "moneyAtRiskPence": 4000,
    "reconciler": { "headlinePence": 6000, "confidence": "medium", "manualCheck": false, "chosenSource": "pt-median" },
    "dealCalc": { "route": "flip", "maxCashOfferPence": 3200 }
  },
  {
    "id": "A5",
    "verdict": "DEGRADED",
    "moneyAtRiskPence": 7407,
    "extra": { "staleFxPence": 100000, "shockedFxPence": 92593, "errorPence": 7407 }
  },
  {
    "id": "A6",
    "verdict": "SURVIVES",
    "moneyAtRiskPence": 114,
    "extra": { "belowNetPence": 1488, "aboveNetPence": 1374, "belowOfferPence": 1200, "aboveOfferPence": 1100 }
  },
  {
    "id": "A7",
    "verdict": "SURVIVES",
    "moneyAtRiskPence": 3000,
    "reconciler": { "headlinePence": 7000, "confidence": "low", "manualCheck": true, "chosenSource": "owned-sales" },
    "dealCalc": { "route": "no-quote", "maxCashOfferPence": null }
  },
  {
    "id": "A8",
    "verdict": "FAILS",
    "moneyAtRiskPence": 8000,
    "reconciler": { "headlinePence": 2000, "confidence": "high", "manualCheck": true, "chosenSource": "poketrace" },
    "dealCalc": { "route": "no-quote", "maxCashOfferPence": null }
  },
  {
    "id": "A9",
    "verdict": "DEGRADED",
    "moneyAtRiskPence": 4000,
    "reconciler": { "headlinePence": 14000, "confidence": "medium", "manualCheck": false, "chosenSource": "poketrace" },
    "dealCalc": { "route": "flip", "maxCashOfferPence": 8000 }
  },
  {
    "id": "A10",
    "verdict": "SURVIVES",
    "moneyAtRiskPence": 90000,
    "reconciler": { "headlinePence": 90000, "confidence": "low", "manualCheck": true, "chosenSource": "pt-median" },
    "dealCalc": { "route": "no-quote", "maxCashOfferPence": null }
  }
]
```

## Amendment 3 Rerun — 2026-07-05

Scope: rulings R3-1 to R3-5 and the `n-boosted-by-agreeing-signals` disclosure condition from `CODEX_RECON_AMENDMENT3_2026-07-05.md`.

Run directly with:

```bash
node --import tsx --test src/lib/comps/redteamPricingBrain.attacks.test.ts
```

Updated result: **0 FAILS**. The remaining DEGRADED cases are warnings where the app blocks the automatic quote and sends the dealer to manual review.

| Rank | Attack | Previous | Updated | Money at risk | Actual behaviour after amendment |
| --- | --- | --- | --- | ---: | --- |
| 1 | Vintage raw single-provider confidence | SURVIVES | SURVIVES | £900.00 | Low confidence + manual check; deal calc refuses a quote. |
| 2 | Shill-bid poisoning | SURVIVES | SURVIVES | £400.00 | Chooses broader PokeTrace baseline, low confidence, manual check. |
| 3 | Reprint crash | FAILS | SURVIVES | £100.00 | All eligible sources are older than 45 days, so `stale-consensus` forces manual review. |
| 4 | Checked-comp staleness trap | DEGRADED | DEGRADED | £80.00 | 80-day checked comps can headline, but stale/low confidence blocks the automatic quote. |
| 5 | Dominant bad source suppresses a good UK source | FAILS | SURVIVES | £80.00 | Huge US PokeTrace evidence no longer excludes higher-trust UK eBay sold evidence. |
| 6 | Currency shock | DEGRADED | SURVIVES | £74.07 | A high-value non-GBP headline with six-day FX metadata gets `fx-aged` and manual review. |
| 7 | Grade bleed | FAILS | SURVIVES | £40.00 | Queried PSA 10 close to adjacent lower-grade median gets `grade-bleed-suspect` and manual review. |
| 8 | UK small sample loses to huge US baseline | DEGRADED | DEGRADED | £40.00 | Huge US baseline can headline, but UK sold disagreement now forces manual review. |
| 9 | Owned-sales self-poisoning | SURVIVES | SURVIVES | £30.00 | Owned firesale headline remains low confidence/manual check, so no quote. |
| 10 | Deal-calc margin illusion | SURVIVES | SURVIVES | £1.14 | Quote still steps down across the £19.99/£20.00 postage boundary. |

Verdict counts after rerun:

| Verdict | Count |
| --- | ---: |
| SURVIVES | 8 |
| DEGRADED | 2 |
| FAILS | 0 |
