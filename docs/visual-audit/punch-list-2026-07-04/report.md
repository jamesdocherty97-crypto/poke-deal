# Visual Punch List Report — 2026-07-04

Evidence base: `POKE_DEAL_VISUAL_BUG_AUDIT_2026-07-04.md`.

Proof screenshots: `docs/visual-audit/punch-list-2026-07-04/after/`.

## Disposition

| # | Result | Proof / note |
|---|---|---|
| 1 | Fixed | Inventory row now keeps primary actions short and moves the rest into `inventory-more-actions-sheet`. |
| 2 | Fixed | Desktop nav becomes a left sidebar at >=1024px; see `after-*-1440x900-inventory-more-actions-sheet.jpg`. |
| 3 | Fixed | Sticky decision bar reserve is present in Buy resolved state; see `buy-resolved-decision-spacing`. |
| 4 | Fixed | Scroll padding and decision bar spacing checked in `buy-resolved-decision-spacing`. |
| 5 | Already fixed / proved | Sheet backdrop is opaque enough in `inventory-sell-sheet-single-primary`. |
| 6 | Fixed | Sell sheet has one pinned primary action; verdict card is informational. |
| 7 | Already fixed / proved | Swipe labels do not bleed in Inventory proof shots. |
| 8 | Already fixed / proved | Toasts anchor above the sticky bar; manual checked-comp proof also exercises this. |
| 9 | Already fixed / proved | Listing pack backdrop is verified in `listing-pack-honest-steps`. |
| 10 | Fixed | Listing wizard steps are informational, and stale eBay connection states link to reconnect. |
| 11 | Fixed | Status view no longer leaves Setup highlighted incorrectly. |
| 12 | Fixed | Desktop navigation relocates to sidebar. |
| 13 | Fixed | Parser recovers `SA 9` to PSA 9; unit test added. |
| 14 | Fixed | Photo selection now shows upload/empty-selection feedback. |
| 15 | Fixed | Smart-search placeholder shortened and ellipsized. |
| 16 | Fixed | Chip rows have edge-fade scroll affordance. |
| 17 | Fixed | Parser/input residue covered by set-token cleanup tests. |
| 18 | Fixed | Half-populated current-card ghost is hidden when no buy context exists. |
| 19 | Fixed | Set-name residue removal tested for Snivy/Crown Zenith-style strings. |
| 20 | Already fixed / proved | Promoted-fee checkbox renders inline at normal size. |

## Stacked-State Matrix

| State | Chromium 390x844 | Chromium 1440x900 | WebKit 390x844 | WebKit 1440x900 |
|---|---|---|---|---|
| Inventory More actions sheet | `after-chromium-390x844-inventory-more-actions-sheet.jpg` | `after-chromium-1440x900-inventory-more-actions-sheet.jpg` | `after-webkit-390x844-inventory-more-actions-sheet.jpg` | `after-webkit-1440x900-inventory-more-actions-sheet.jpg` |
| Inventory sell sheet | `after-chromium-390x844-inventory-sell-sheet-single-primary.jpg` | `after-chromium-1440x900-inventory-sell-sheet-single-primary.jpg` | `after-webkit-390x844-inventory-sell-sheet-single-primary.jpg` | `after-webkit-1440x900-inventory-sell-sheet-single-primary.jpg` |
| Buy empty state | `after-chromium-390x844-buy-empty-chips-placeholder.jpg` | `after-chromium-1440x900-buy-empty-chips-placeholder.jpg` | `after-webkit-390x844-buy-empty-chips-placeholder.jpg` | `after-webkit-1440x900-buy-empty-chips-placeholder.jpg` |
| Buy resolved + sticky bar | `after-chromium-390x844-buy-resolved-decision-spacing.jpg` | `after-chromium-1440x900-buy-resolved-decision-spacing.jpg` | `after-webkit-390x844-buy-resolved-decision-spacing.jpg` | `after-webkit-1440x900-buy-resolved-decision-spacing.jpg` |
| Listing pack steps | `after-chromium-390x844-listing-pack-honest-steps.jpg` | `after-chromium-1440x900-listing-pack-honest-steps.jpg` | `after-webkit-390x844-listing-pack-honest-steps.jpg` | `after-webkit-1440x900-listing-pack-honest-steps.jpg` |
| Setup deep health | `after-chromium-390x844-setup-deep-health-rows.jpg` | `after-chromium-1440x900-setup-deep-health-rows.jpg` | `after-webkit-390x844-setup-deep-health-rows.jpg` | `after-webkit-1440x900-setup-deep-health-rows.jpg` |

Extra proof: `after-chromium-390x844-manual-checked-comp-retained.jpg` proves the dealer-logged comp no longer resets the Buy page even when the follow-up `/api/comps` refresh returns blank.

## Health And Drift

- Deep source health: `docs/HEALTH_CHECK_2026-07-04.md`.
- Production comp drift: `docs/COMPS_DRIFT_2026-07-04.md`.
- Cron health: `docs/CRON_HEALTH_2026-07-04.md`.

## Remaining External Blockers

- eBay Marketplace Insights still requires eBay approval before true UK sold-grade comps can be enabled.
- Daily eBay sales sync has a live OAuth permission failure. The app already requests fulfillment scopes; the stored seller consent needs one fresh `/api/ebay/connect?force=1` reconnect after deploy.
