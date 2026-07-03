# V1 - One Sheet System

## Scope

V1 moved the app's sheet-style surfaces onto one bottom-anchored pattern:

- `.sell-sheet`: inventory edit, create listing, listing edit, sale form, listing pack.
- `.confirm-sheet`: destructive delete confirmation.
- `.ebay-publish-overlay` / `.ebay-publish-confirm`: eBay publish confirmation.

The pattern is bottom anchored, capped at `85dvh`, internally scrollable, safe-area padded, backdroped, body scroll-locked, and uses a 200ms transform entrance. Destructive confirm actions are full-width at the bottom of the sheet.

## Screenshot Evidence

Standard 390x844 before/after galleries:

- Before: `docs/visual-audit/v1/before/`
- After: `docs/visual-audit/v1/after/`

Additional V1 sheet proofs:

- `docs/visual-audit/v1/after/v1-after-publish-confirm-keyboard-closed.jpg`
- `docs/visual-audit/v1/after/v1-after-publish-confirm-keyboard-open.jpg`
- `docs/visual-audit/v1/after/v1-after-listing-pack-sheet.jpg`
- `docs/visual-audit/v1/after/v1-after-sale-sheet.jpg`
- `docs/visual-audit/v1/after/v1-after-delete-confirm-sheet.jpg`

## Publish Confirm Proof

The publish-confirm proof used a Playwright-only network override for `/api/listings` so the real React publish confirmation could be rendered without creating an eBay offer, writing to the database, or publishing anything.

Measured at 390px wide, device scale factor 3:

| State | Viewport | Sheet top | Sheet bottom | Fully visible | Body scroll lock |
| --- | ---: | ---: | ---: | --- | --- |
| Keyboard closed | 390x844 | 513 | 844 | yes | `overflow: hidden` |
| Keyboard open simulation | 390x520 | 189 | 520 | yes | `overflow: hidden` |

The keyboard-open simulation reduces the visual viewport height to represent the phone viewport after the software keyboard appears.
