# V3 Generated Art And Identity Layer

## Scope

- Replaced the homescreen identity with a generated cracked Pokeball/card-glow icon.
- Added a lightweight launch splash reference, deep-navy manifest theme color, and refreshed app icon metadata.
- Added six small UI-only empty-state stickers under `public/visual/empty/`.
- Added illustrated empty-state rendering through the shared `EmptyState` component.
- Added bottom-nav line icons, a CSS Pokeball comp spinner, subtle holo background texture, and a short success-toast sparkle.

## Visual Verification

- Before gallery: `docs/visual-audit/v3/before/`
- After gallery: `docs/visual-audit/v3/after/`
- Extra focused check: `v3-after-empty-search.jpg`
- Empty-search Playwright assertion: `documentElement.scrollWidth = 390`, `body.scrollWidth = 390`, viewport width `390`.

## Asset Budget

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
| Total final identity/art payload | 356,568 |

Every final art asset is under 60KB. The tracked 512 PNG was replaced by `icon-512.jpg` so the large homescreen asset stays inside the phase budget.

## Image Generation Notes

- Built-in image generation was used for the app identity direction and the first empty-state pass.
- Exact named-character generation was rejected by the image tool. During V6, the six empty-state stickers were corrected to actual Pokémon using small locally saved official-artwork PNGs in one consistent artwork style: Snorlax, Meowth, Noctowl, Chansey, Machop and Psyduck.
- Final UI assets are decorative only. They are referenced only by app chrome/empty states and are not used by listing photos, listing packs, eBay payloads, exports, or catalog-photo flows.
- `sips` AVIF output crashed locally, so the first-pass in-app stickers were resized/compressed as JPEG.
- The V6 corrective pass uses resized PNGs so the actual Pokémon artwork retains transparent edges over the existing holo empty-state panels.

## Prompt Summary

- App icon: cracked Pokeball-style sphere opening around a holographic trading-card glow on deep navy.
- Empty stock: original sleepy blue collector mascot on an empty binder.
- No sales: original cream/gold shop mascot watching a single coin.
- No watches: original night watcher mascot perched beside a target marker.
- No alerts: original pink helper mascot relaxing beside a quiet bell.
- Empty session: original small strong fair mascot with an empty cart.
- No search results: original confused yellow search mascot with magnifying glass and blank sleeve.

## Gates

- `npm test`: pass, 661 tests.
- `npx tsc -p tsconfig.check.json`: pass.
- `npm run build`: pass.
