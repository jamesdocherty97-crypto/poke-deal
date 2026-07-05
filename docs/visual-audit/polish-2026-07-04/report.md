# Visual Polish Pass - 2026-07-04

## Scope

This pass focused on app feel and screen identity, using the existing recognizable Pokemon-style UI art as app decoration only.

## Updates

- Added a Today hero panel with a time-of-day greeting, live operating counts and fast actions.
- Added subtle screen-specific art accents:
  - Today: stock art
  - Buy: session art
  - Inventory: stock art
  - Listings: sales art
  - P&L: watches art
  - Setup: alerts art
- Strengthened panel depth with restrained gradients and shadows.
- Increased headline metric weight for faster scanning.
- Gave the comp headline and receipt a more obvious holo treatment.
- Enlarged and centered the Pokeball lookup spinner treatment in the lookup-progress card.
- Added a branded Poke Deal password fallback screen while keeping the existing HTTP Basic gate.
- Moved app-facing GBP display copy onto one shared formatter so prices render consistently as `£12.50` style strings.

## Listing Safety

No UI art paths are referenced from eBay listing payload code. The character art remains app-only and does not enter listing photos, listing packs, offer creation, or publish payloads.

## Screenshots

Mobile after screenshots:

- `docs/visual-audit/polish-2026-07-04/after/polish-after-mobile-today.jpg`
- `docs/visual-audit/polish-2026-07-04/after/polish-after-mobile-buy.jpg`
- `docs/visual-audit/polish-2026-07-04/after/polish-after-mobile-inventory.jpg`
- `docs/visual-audit/polish-2026-07-04/after/polish-after-mobile-listings.jpg`
- `docs/visual-audit/polish-2026-07-04/after/polish-after-mobile-profit.jpg`
- `docs/visual-audit/polish-2026-07-04/after/polish-after-mobile-setup.jpg`

Desktop after screenshots are in `docs/visual-audit/desktop/after/`.
