# V6 Verify & Ship

Captured against local dev at 390x844, deviceScaleFactor 3.

## Scope

- Completed the final visual audit report and gallery index.
- Corrected the V3 empty-state art gap: exact named-character generation was rejected by the image tool, so V6 replaced the original mascot JPEGs with small local actual-Pokemon PNGs in a single official-artwork style.
- Kept the corrective art inside app UI empty states only. No listing image, listing pack, export, catalog-photo flow, eBay inventory payload or eBay publish path references these assets.

## Screenshot Gallery

Before gallery:

- `docs/visual-audit/v6/before/v6-before-today.jpg`
- `docs/visual-audit/v6/before/v6-before-buy.jpg`
- `docs/visual-audit/v6/before/v6-before-inventory.jpg`
- `docs/visual-audit/v6/before/v6-before-listings.jpg`
- `docs/visual-audit/v6/before/v6-before-profit.jpg`
- `docs/visual-audit/v6/before/v6-before-setup.jpg`

After gallery:

- `docs/visual-audit/v6/after/v6-after-today.jpg`
- `docs/visual-audit/v6/after/v6-after-buy.jpg`
- `docs/visual-audit/v6/after/v6-after-inventory.jpg`
- `docs/visual-audit/v6/after/v6-after-listings.jpg`
- `docs/visual-audit/v6/after/v6-after-profit.jpg`
- `docs/visual-audit/v6/after/v6-after-setup.jpg`

Focused proof:

- Actual-Pokemon empty state: `docs/visual-audit/v6/after/v6-after-empty-search-actual-pokemon.jpg`

## V2 Root Cause

The autocomplete bug came from suggestions being rendered as generic flexible buttons with a thumbnail, name and one free-flowing metadata line. Long set, rarity and source text competed for the same row space, so mobile rows wrapped unpredictably and behaved like loose content rather than a bounded autocomplete listbox.

## CSS Line Counts

Before V0:

- `src/app/globals.css`: 7,170 lines.

Final V6:

- `src/app/globals.css`: 4 lines.
- `src/app/styles/tokens.css`: 77 lines.
- `src/app/styles/base.css`: 525 lines.
- `src/app/styles/components.css`: 6,163 lines.
- `src/app/styles/screens.css`: 900 lines.
- Total final CSS: 7,669 lines.

The final CSS is larger than the starting monolith because the visual system now includes named tokens, mobile sheet primitives, autocomplete/listbox treatments, art/empty-state presentation, accessibility states, motion rules and audit-driven screen polish.

## Asset Weight

Final identity/art payload:

| Asset | Bytes |
| --- | ---: |
| `public/icon-192.png` | 51,393 |
| `public/icon-512.jpg` | 24,252 |
| `public/apple-touch-icon.png` | 46,023 |
| `public/icon.svg` | 1,987 |
| `public/splash.svg` | 1,880 |
| `public/visual/empty/stock.png` | 43,480 |
| `public/visual/empty/sales.png` | 37,033 |
| `public/visual/empty/watches.png` | 32,628 |
| `public/visual/empty/alerts.png` | 44,452 |
| `public/visual/empty/session.png` | 36,167 |
| `public/visual/empty/search.png` | 37,273 |
| Total | 356,568 |

Every individual final art asset is below 60KB, and the total identity/art payload is below the 500KB budget.

## Screens Changed

- Today: topbar, status/readiness panels, alerts, empty states and pull-to-refresh feel.
- Buy: comp search, suggestions, decision bar, receipt evidence grammar, quick actions and motion.
- Inventory: row spacing, photo tools, filters, primary actions, empty states and tab-switch feel.
- Listings: listing desk, eBay publish/readiness sheets, photo next actions, pack surfaces and empty states.
- P&L: metric cards, tables, watch/alert surfaces and empty states.
- Setup: settings panels, health/status blocks and sheet consistency.

## Playwright Measurements

Focused V6 empty-state proof:

| Check | Result |
| --- | --- |
| Viewport | 390 |
| `documentElement.scrollWidth` | 390 |
| `body.scrollWidth` | 390 |
| Active tab | Inventory |
| Empty image | `/visual/empty/search.png` |

## Top 5 Logic-Bound Improvements Left

1. Pre-mount or route-split tab workspaces cleanly instead of relying on a CSS shell skeleton during lazy tab gaps.
2. Add CI visual regression with seeded app data and deterministic browser captures for every required screen state.
3. Make sheet/toast close animations stateful so exits animate without delaying data updates.
4. Add a runtime contrast check for live card art and generated/official artwork against dark panels.
5. Add source-aware receipt icons from typed data fields rather than CSS heuristics, so solds, asks and catalog evidence remain visually correct as comp sources expand.

## Gates

- `npm test`: pass, 662 tests.
- `npx tsc -p tsconfig.check.json`: pass.
- `npm run build`: pass.
- Production deploy: pass, deployed to `https://poke-deal.vercel.app`.
- `npm run verify:prod`: pass, 5/5 production cards.
