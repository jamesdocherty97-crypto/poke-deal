# Poke Deal Visual Audit Index

All galleries were captured at 390x844 with deviceScaleFactor 3 unless a focused proof states a narrower setup.

## Phase Summary

| Phase | Commit | Report | Before | After | Extra Proof |
| --- | --- | --- | --- | --- | --- |
| V0 - design tokens and CSS hygiene | `a4a7446` | `docs/visual-audit/v0/report.md` | `docs/visual-audit/v0/before/` | `docs/visual-audit/v0/after/` | CSS split/line-count report |
| V1 - one sheet system | `ae639a2` | `docs/visual-audit/v1/report.md` | `docs/visual-audit/v1/before/` | `docs/visual-audit/v1/after/` | publish confirm keyboard open/closed |
| V2 - search and autocomplete | `226edc0` | `docs/visual-audit/v2/report.md` | `docs/visual-audit/v2/before/` | `docs/visual-audit/v2/after/` | card, smart and set suggestion repros |
| V3 - generated art and identity | `753827a` | `docs/visual-audit/v3/report.md` | `docs/visual-audit/v3/before/` | `docs/visual-audit/v3/after/` | empty-search art proof |
| V4 - screen sweep | `c0b4565` | `docs/visual-audit/v4/report.md` | `docs/visual-audit/v4/before/` | `docs/visual-audit/v4/after/` | confident, manual-check and ambiguous decision bars |
| V5 - motion and feel | `b5005cf` | `docs/visual-audit/v5/report.md` | `docs/visual-audit/v5/before/` | `docs/visual-audit/v5/after/` | tab-switch skeleton proof |
| V6 - verify and ship | final V6 commit | `docs/visual-audit/v6/report.md` | `docs/visual-audit/v6/before/` | `docs/visual-audit/v6/after/` | actual-Pokemon empty-state proof |
| Art V2 - recognizable Pokemon pass | pending | `docs/visual-audit/art-v2/report.md` | `docs/visual-audit/art-v2/before/` | `docs/visual-audit/art-v2/after/` | all-art focused proof |
| Pass 2 - stacked states and elevation | pending | `docs/visual-audit/pass2/report.md` | `docs/visual-audit/pass2/before/` | `docs/visual-audit/pass2/after/` | Chromium + WebKit stacked matrix |

## Final Evidence Highlights

- CSS monolith split from one 7,170-line `globals.css` into a 4-line import file plus token/base/component/screen files.
- Final identity/art payload: 356,568 bytes, below the 500KB budget.
- Every final app art asset is below 60KB.
- Empty-state UI art now uses actual Pokémon PNGs in a single official-artwork style while remaining app-only.
- eBay/listing outbound surfaces continue to use only real photos, catalog card scans and listing data paths.
- Production verification remains the five-card `npm run verify:prod` basket.
