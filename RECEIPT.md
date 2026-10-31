# RECEIPT: phone layout B1 to B6

Date: 31 Oct 2026. Branch starts from `main` `638fa9f` (PR #31). Closed PR #32 was not reopened and was not merged.

This tip is not `c0747d0`. That commit is the 21 Oct tree Argon scored. The functional phone work from that tip is here as new commits, then the layout and audit fixes were added on top.

## What failed before: Argon 0 of 6

Prism's functional phone pass on `c0747d0` was 8 of 8. The exit gate was the layout score, not those checks.

Argon High on `c0747d0` (`qc-design/QC-PRISM-P1R2-P2.md`):

| Screen | Argon on c0747d0 | Verdict |
|---|---|---|
| B1 Stock, partial load | 6.5 | FIX |
| B2 Price check, owned card | 6.5 | FIX |
| B3 Create listing sheet | 6.0 | FIX |
| B4 Price error | 5.5 | FIX |
| B5 Bottom bar | 4.5 | FIX |
| B6 Edit stock sheet | 5.5 | FIX |

0 of 6 reached 8. Average after that pass was 5.75, up from 3.58 on the earlier shots.

PR #32 (`cursor/phone-fix-gate-2871`, head `c0747d0`) opened that same tip again on 31 Oct. Its RECEIPT called "0 of 6" the functional load failures. That was the wrong failure. The functional checks had already passed. The open failure was the six Argon layout screens, and the diff did not contain the Prism FIX markers. `ship-gates` also failed at `npm audit --omit=dev` before typecheck, unit, build, or e2e ran. The PR was closed. It stays closed.

## What this branch changes

### A1 to A9

Ported from the unmerged tip onto new commits from `main`. Same behaviour Prism already passed, new hashes:

- Partial stock and list loads keep the rows that arrived and show a banner above them, with one Retry tap and a busy "Retrying…" label.
- Draft listing on a price check opens Create listing on `?view=stock`, and Your list price prefills `42.00` from the check (£42.00), not the raw buy figure.
- Sheet primaries stay `#0a0d16` on `#e96a74` (about 6.26:1).
- An owned priced card does not render `.mobile-buy-action` or an Add cost buy control.
- Bottom-bar copy still fits at 390 and 430. The 320 clip stays out of scope.
- A comp stream 500 shows `.comp-lookup-alert` with the plain sentence and Retry. No raw server text and no toast.
- Missing art stays a dashed No photo slot.

Prior shipped behaviour is untouched: skip link (#30), Today retry (#31), scan budget (#29), and the DB-free eBay deletion route.

### B1 to B6

These are new on this branch. They were not in `c0747d0`.

- **B1.** When holding, active, and in-view counts match, the 3-up vault line collapses to "1 card in stock" (or "N cards in stock"). The phone rule removes the inner border and background on the Refresh comps / Select all row. The partial-load banner and Retry stay above the first stock row.
- **B2.** On an owned price check the hero kicker is "Suggested list price" and the figure is the suggested list price (£42.00 on the fixture), not "Suggested maximum buy". The primary is "Draft listing", with "In stock · Paid £25.00". It is not the green Add to stock button. Next card spans `grid-column: 1 / -1` on a phone.
- **B3 and B6.** `.sell-sheet > .primary-action` no longer uses `margin: 8px -16px -16px`. That negative margin shifted the 336px button instead of stretching it, so Cert and Status stuck out past Save stock. The button now stays in the field column (`margin` left and right `0`, `width: 100%`) and keeps the safe-area padding on the bottom. `.sell-sheet` paints a backdrop of `rgba(5, 8, 15, 0.72)`.
- **B4.** While `.comp-lookup-alert` is on screen, the sticky buy bar is not rendered, so Open UK is not a third coral primary. Comp uses `grid-column: 1 / -1`, the same width as Next. Retry stays the recovery control.
- **B5.** The deal bar title is "Cost needed". The coral button remains "Add cost". The two labels no longer repeat.

### Audit

`npm audit --omit=dev` on this `main` lockfile was red: undici `6.29.0` (GHSA-4qv8-2p9j-2685, patched in `6.29.1`) and zod below `4.6.6` (GHSA-mrhx-c7xc-m3w5). Zod was both the app dependency `3.25.76` and `@vercel/blob` → `@vercel/oidc` → `@vercel/cli-config` pin `zod@4.1.11`.

`npm audit fix --force` was not used. That command's only offered zod fix is a blind major. The advisory's first patched release is `4.6.7` (range `< 4.6.6`, no 3.x patch). This branch sets the app dependency to `zod@4.6.7` and overrides `zod` and `undici` to `4.6.7` and `6.29.1`. `@vercel/blob` stays `2.5.0` on the existing `^2.5.0` range.

`npm audit --omit=dev` on this lockfile: **0 vulnerabilities**. `npm run typecheck` passed. `npm test`: **1103 passed, 0 failed, 2 skipped**.

## Tests and shots

Local, this tip:

- `npm run typecheck`: pass
- `npm test`: 1103 passed, 0 failed, 2 skipped
- Playwright `e2e/sell-flow-phone.spec.ts` and `e2e/dealer-reliability.spec.ts`: the A1 to A9 phone specs plus new B1 to B6 layout checks (banner above the row, one-line vault count, list-price hero, field-aligned sheet buttons, dim backdrop, Comp width matching Next, buy bar hidden on the price error, "Cost needed" vs "Add cost")
- The first CI `ship-gates` run passed audit, unit tests, typecheck and build. `npm run test:e2e` failed one check: the Drafts filter peeked 9px at 390, under the 16px floor. Locally the same row peeked 26px. Forcing DejaVu Sans reproduced the CI width. Phone filter tabs now use 8px of horizontal padding, which leaves a 33px peek in DejaVu Sans.

Argon has **not** been re-scored on this tip. These shots are for that re-score. They are viewport captures at 390×844 and 430×932, before (`497a07d`, same UI as `c0747d0`) and after (this branch). The dev-server Next badge is hidden in the captures.

Before shots still show the 0 of 6 causes: the 3-up "1 HOLDING / 1 ACTIVE CARD / 1 IN VIEW", "SUGGESTED MAXIMUM BUY £23.00" with green Add to stock, a half-width Next card, "Add cost" as both the bar title and the button.

## Prism rescore on 55ed617: 4 of 6

Argon scored this branch's first tip `55ed617` at 4 of 6. B1 to B4 passed. B5 and B6 were still FIX. The follow-up on this same branch changes only those two:

- **B6.** The Edit stock header is an opaque bar (`#0e1220`, sticky `top: 0`, above the scrolling fields). The focused price uses `scroll-margin-top: 104px`, which is at least the header height, so the field sits below the header instead of under it. The helper now reads "cost basis, not the card comp or sell price."
- **B5.** While the deal bar is on screen, the in-page Add to stock and Next card controls are not rendered into the gap under that bar. The page bottom padding clears the bar, the nav and a gap. The phone nav is a solid full-width bar (`#0b0e18`, no blur, no glass layer) that meets the deal bar, so page text does not show through it. The dashed comp art slot reads "No photo".

## Not scored ready

Do not merge and do not deploy from this receipt. CI on the PR head still has to go green, and Prism still has to re-score B1 to B6 on this tip. Scored ready needs CI green, A1 to A9 still true, and Argon at 8 or more on all six screens. Until that re-score, this stays open for review.
