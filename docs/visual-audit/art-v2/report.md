# Art V2 Recognizable Pokemon Pass

Captured against local dev at 390x844, deviceScaleFactor 3.

## Scope

- Replaced the six empty-state UI art PNGs with transparent exact-character composites that add the requested scene cues.
- Added a tiny Pikachu celebration asset to success toasts.
- Tightened the comp loading spinner into an inline SVG Pokeball.
- Retained the existing app icon and splash identity because they already show the cracked Pokeball with a glowing holo card.
- Kept nav tab icons as clean symbols.

The AI image generator rejected an exact named-Pokemon Snorlax prompt. To avoid shipping generic lookalikes, this pass used deterministic browser-rendered composites built from exact Pokemon artwork and lightweight SVG scene props.

## Screenshots

Before:

- `docs/visual-audit/art-v2/before/art-v2-before-today.jpg`
- `docs/visual-audit/art-v2/before/art-v2-before-buy.jpg`
- `docs/visual-audit/art-v2/before/art-v2-before-inventory.jpg`
- `docs/visual-audit/art-v2/before/art-v2-before-listings.jpg`
- `docs/visual-audit/art-v2/before/art-v2-before-profit.jpg`
- `docs/visual-audit/art-v2/before/art-v2-before-setup.jpg`
- `docs/visual-audit/art-v2/before/art-v2-before-focused-proof.jpg`

After:

- `docs/visual-audit/art-v2/after/art-v2-after-today.jpg`
- `docs/visual-audit/art-v2/after/art-v2-after-buy.jpg`
- `docs/visual-audit/art-v2/after/art-v2-after-inventory.jpg`
- `docs/visual-audit/art-v2/after/art-v2-after-listings.jpg`
- `docs/visual-audit/art-v2/after/art-v2-after-profit.jpg`
- `docs/visual-audit/art-v2/after/art-v2-after-setup.jpg`
- `docs/visual-audit/art-v2/after/art-v2-after-focused-proof.jpg`

## Recognizability Log

| UI asset | Target | Shipped generation attempt | Result |
| --- | --- | ---: | --- |
| Empty stock | Snorlax asleep on an open empty binder | 1 | Pass: Snorlax named instantly; binder cue visible. |
| No sales yet | Meowth with coin | 1 | Pass: Meowth named instantly; gold coin cue added. |
| No watches | Noctowl perched alert | 1 | Pass: Noctowl named instantly; branch perch added. |
| No alerts | Chansey relaxed/content | 1 | Pass: Chansey named instantly; calm scene cue added. |
| Empty session | Machop flexing beside empty basket | 1 | Pass: Machop named instantly; basket cue added. |
| No search results | Psyduck confused, clutching head | 1 | Pass: Psyduck named instantly; confusion marks added. |
| Comp loading spinner | Clean red/white/black Pokeball | 1 | Pass: inline SVG Pokeball with exact top/band/button structure. |
| Success flourish | Tiny Pikachu mid-spark with holo confetti | 1 | Pass: Pikachu named instantly; 0.78s non-blocking toast flourish. |
| App icon and splash | Cracked Pokeball revealing glowing holo card | retained | Pass: existing vector/raster PWA identity already matched the brief. |
| Nav tabs | Pokeball, card stack, price tag, coin, bolt symbols | retained | Pass: deliberately iconographic, not character art. |

No shipped asset failed the one-second recognizability test.

## Asset Budget

| Asset | Bytes | Alpha |
| --- | ---: | --- |
| `public/visual/empty/stock.png` | 35,486 | yes |
| `public/visual/empty/sales.png` | 33,554 | yes |
| `public/visual/empty/watches.png` | 25,036 | yes |
| `public/visual/empty/alerts.png` | 30,711 | yes |
| `public/visual/empty/session.png` | 26,070 | yes |
| `public/visual/empty/search.png` | 27,668 | yes |
| `public/visual/celebration/pikachu.png` | 19,267 | yes |
| `public/icon-192.png` | 51,393 | no, PWA icon |
| `public/icon-512.jpg` | 24,252 | no, PWA icon |
| `public/apple-touch-icon.png` | 46,023 | no, Apple icon |
| `public/icon.svg` | 1,987 | no, vector identity |
| `public/splash.svg` | 1,880 | no, launch image |

Every PNG/JPG art asset remains under 60KB.

## Listing Payload Guard

Path scan confirms the character art is app UI only:

- Empty art is referenced only by `src/app/components/UiBits.tsx`.
- Pikachu celebration art is referenced only by toast CSS in `src/app/styles/components.css`.
- Listing pack, catalog-photo, export and eBay publish code paths do not reference `/visual/empty` or `/visual/celebration`.

