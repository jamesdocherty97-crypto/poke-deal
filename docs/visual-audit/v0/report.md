# V0 Visual Audit

## Screenshots

Captured at 390x844, deviceScaleFactor 3, against local dev.

- Before: `docs/visual-audit/v0/before/`
- After: `docs/visual-audit/v0/after/`
- Screens: Status, Buy, Inventory, Listings, P&L, Setup

## CSS Hygiene

- Before: `src/app/globals.css` was a 7,170-line monolith.
- After: `src/app/globals.css` is a 4-line import file.
- Split files:
  - `src/app/styles/tokens.css`: 73 lines
  - `src/app/styles/base.css`: 448 lines
  - `src/app/styles/components.css`: 5,804 lines
  - `src/app/styles/screens.css`: 907 lines
- Total CSS after split: 7,236 lines. The increase is from the new token system.

## V0 Changes

- Added spacing, type, radius, shadow, semantic, confidence, holo, and z-index tokens.
- Added tabular numerals app-wide through the base text stack.
- Replaced numeric z-index values with named z-index tokens.
- Single-sourced the base `.confirm-sheet` rule outside responsive overrides.
