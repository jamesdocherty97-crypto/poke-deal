# Visual Punch List Final Report - 2026-07-05

Target production app: `https://poke-deal.vercel.app`

This closes the 2026-07-04 visual punch list plus the comp/API health once-over and bounded polish pass.

## Disposition

| # | Finding | Result | Proof |
|---|---|---|---|
| 1 | Row action overflow | Fixed | More actions sheet matrix in `after/` and `part0-prod/` |
| 2 | Desktop nav collision | Fixed | Desktop sidebar proof in `after-*-1440x900-*` and `part0-prod-*1440x900*` |
| 3 | Profit field hidden by sticky bar | Fixed | `buy-resolved-decision-spacing` |
| 4 | Sticky bar crowding resolved comp state | Fixed | `buy-resolved-decision-spacing` |
| 5 | Sheet backdrop bleed | Already fixed, re-proved | `part0-prod-*-inventory-sell-sheet-single-primary.jpg` |
| 6 | Multiple sell CTAs | Fixed | `inventory-sell-sheet-single-primary` |
| 7 | Swipe labels visible at rest | Already fixed, re-proved | `part0-prod-*-inventory-resting-row.jpg` |
| 8 | Toast over action bar | Already fixed, re-proved | `part0-prod-*-buy-success-toast-placement.jpg` |
| 9 | Listing pack backdrop bleed | Already fixed, re-proved | `part0-prod-*-listing-pack-honest-steps.jpg` |
| 10 | Fake listing wizard steps | Fixed | `listing-pack-honest-steps` |
| 11 | Status page highlights Setup | Fixed | Punch-list report and setup/status proof |
| 12 | Desktop nav remains mobile pill | Fixed | Desktop sidebar proof |
| 13 | Grade token dropped while typing | Fixed | Parser tests cover `SA 9` recovery |
| 14 | Photos action gives no feedback | Fixed | Photo feedback tests and UI flow |
| 15 | Placeholder hard-clips | Fixed | `buy-empty-chips-placeholder` |
| 16 | Chip rows no scroll affordance | Fixed | `buy-empty-chips-placeholder` |
| 17 | Select-all residue | Fixed | Parser/input cleanup tests |
| 18 | Half-populated current-card ghost | Fixed | Hidden when no buy context exists |
| 19 | Set tokens leak into card field | Fixed | Parser tests for reported strings |
| 20 | Promoted-fee checkbox misaligned | Already fixed, proved | Punch-list setup proof |

## Screenshot Evidence

- Current production re-verification: `docs/visual-audit/punch-list-2026-07-04/part0-prod/`
- Production re-verification summary: `docs/visual-audit/punch-list-2026-07-04/part0-prod-report.md`
- Original punch-list proof matrix: `docs/visual-audit/punch-list-2026-07-04/report.md`
- Bounded polish proof: `docs/visual-audit/polish-2026-07-04/report.md`

The production matrix includes Chromium and WebKit at 390x844 and 1440x900, including the More actions sheet and desktop sidebar states.

## Comp And API Health

- Deep source health: `docs/HEALTH_CHECK_2026-07-05.md`
- Production comp drift: `docs/COMPS_DRIFT_2026-07-05.md`
- Tauros transient catalog recheck: `docs/COMPS_DRIFT_2026-07-05_tauros-recheck.json`
- eBay sales sync live proof: `docs/EBAY_SALES_SYNC_PROOF_2026-07-05.json`
- Cron health: `docs/CRON_HEALTH_2026-07-05.md`

Required production sources are green: Price Tracker, Pokemon TCG API, Neon DB. Optional/live helpers are explained: PSA cert lookup returned PSA HTTP 429, eBay Marketplace Insights remains skipped until eBay grants access, and eBay Browse/Sell are reachable.

The latest scheduled eBay sales-sync cron row is still yesterday's failed fulfillment-scope run, but the live production sync endpoint now returns OK with zero fetched orders. That indicates the seller connection itself is healthy; the cron row should turn green on the next scheduled run.

## Failure Honesty

The comp failure path remains covered by `src/lib/comps/compService.test.ts` and source-specific tests: failed or timed-out sources produce visible unavailable reasons, all sources resolve via bounded timeouts/allSettled, and warm cached comps stay visible instead of blanking the receipt.

## Finishing Polish

- App-facing GBP copy now uses `src/lib/format/money.ts`.
- Focus-visible, iOS dark theme color/status bar, drag handles, press states, sticky reserves, skeleton styling, Today operating empty state, and 320px decision-bar spacing are already represented in the existing visual proof set.

