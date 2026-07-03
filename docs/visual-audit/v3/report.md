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
| `public/visual/empty/stock.jpg` | 11,711 |
| `public/visual/empty/sales.jpg` | 11,210 |
| `public/visual/empty/watches.jpg` | 11,903 |
| `public/visual/empty/alerts.jpg` | 9,928 |
| `public/visual/empty/session.jpg` | 13,611 |
| `public/visual/empty/search.jpg` | 10,415 |
| Total final identity/art payload | 194,313 |

Every final V3 asset is under 60KB. The tracked 512 PNG was replaced by `icon-512.jpg` so the large homescreen asset stays inside the phase budget.

## Image Generation Notes

- Built-in image generation was used.
- Exact named-character generation was rejected by the image tool, so the six empty-state stickers use original Poke Deal collector mascots in a consistent soft-shaded sticker style.
- Final UI assets are decorative only. They are referenced only by app chrome/empty states and are not used by listing photos, listing packs, eBay payloads, exports, or catalog-photo flows.
- `sips` AVIF output crashed locally, so the in-app stickers were resized/compressed as JPEG instead.

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
