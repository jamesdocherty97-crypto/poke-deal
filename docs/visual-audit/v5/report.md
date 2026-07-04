# V5 Motion & Feel

Captured against local dev at 390x844, deviceScaleFactor 3.

## Scope

- Added shared motion tokens for fast UI transitions, sheet entry and primary press scale.
- Standardized sheet, dropdown/listbox and toast entry timing to 150-190ms ease-out.
- Kept data and money updates instant. No metric, price or table number animation was added.
- Unified toast presentation around one bottom-anchored style above the nav; tone changes now come from border/text treatment rather than a different layout.
- Added 0.98 press-down scale for primary action surfaces.
- Added a CSS-only tab-switch skeleton for the brief lazy gap while heavier tab workspaces mount.
- Expanded reduced-motion handling so animations/transitions collapse for users who request it.

## Screenshot Gallery

Before gallery:

- `docs/visual-audit/v5/before/v5-before-today.jpg`
- `docs/visual-audit/v5/before/v5-before-buy.jpg`
- `docs/visual-audit/v5/before/v5-before-inventory.jpg`
- `docs/visual-audit/v5/before/v5-before-listings.jpg`
- `docs/visual-audit/v5/before/v5-before-profit.jpg`
- `docs/visual-audit/v5/before/v5-before-setup.jpg`

After gallery:

- `docs/visual-audit/v5/after/v5-after-today.jpg`
- `docs/visual-audit/v5/after/v5-after-buy.jpg`
- `docs/visual-audit/v5/after/v5-after-inventory.jpg`
- `docs/visual-audit/v5/after/v5-after-listings.jpg`
- `docs/visual-audit/v5/after/v5-after-profit.jpg`
- `docs/visual-audit/v5/after/v5-after-setup.jpg`

Focused proof:

- Lazy-tab skeleton: `docs/visual-audit/v5/after/v5-after-tab-skeleton.jpg`

## Playwright Measurements

Final post-change tab pass:

| Screen | heading switch | document scrollWidth | body scrollWidth | viewport | mounted workspace at 250ms | skeleton at 250ms |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Today | 102ms | 390 | 390 | 390 | yes | no |
| Buy | 37ms | 390 | 390 | 390 | yes | no |
| Inventory | 18ms | 390 | 390 | 390 | no | yes |
| Listings | 17ms | 390 | 390 | 390 | no | yes |
| P&L | 24ms | 390 | 390 | 390 | no | yes |
| Setup | 23ms | 390 | 390 | 390 | no | yes |

## Notes

- The heavier tabs change the header immediately, then mount their workspace shortly after. V5 covers that short gap with a CSS-only shell skeleton, avoiding a blank-looking tab switch without changing app logic.
- The skeleton uses the existing panel treatment and does not animate any numbers.
