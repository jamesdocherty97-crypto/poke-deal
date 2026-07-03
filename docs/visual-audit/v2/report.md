# V2 - Search And Autocomplete

## Reproduction

Playwright reproduced the autocomplete issue on the Buy screen at 390x844:

- `docs/visual-audit/v2/before/v2-before-card-suggestions-repro.jpg`
- Input: `Umbreon prismatic` in the advanced Card field.

## Root Cause

Suggestions were rendered as generic flexible buttons with a thumbnail, name, and one free-flowing metadata line. Long set/rarity/source text competed for the same row space, so mobile rows wrapped unpredictably and behaved like loose content rather than a bounded autocomplete listbox.

## Fix

- Added a shared `.suggestion-listbox` shell for smart card, card field, and set field suggestions.
- Rebuilt suggestion rows as fixed-column grids: thumbnail, name, set/source, and number.
- Bounded dropdown height with internal scrolling.
- Added hover, focus-visible, and pressed states.
- Added ArrowUp/ArrowDown list navigation helpers for visible suggestion lists.
- Verified no horizontal page scroll in the focused repro: viewport width `390`, document scroll width `390`.

## Screenshot Evidence

Standard screen gallery:

- Before: `docs/visual-audit/v2/before/`
- After: `docs/visual-audit/v2/after/`

Focused after screenshots:

- `docs/visual-audit/v2/after/v2-after-card-suggestions-repro.jpg`
- `docs/visual-audit/v2/after/v2-after-smart-suggestions-repro.jpg`
- `docs/visual-audit/v2/after/v2-after-set-suggestions-repro.jpg`
