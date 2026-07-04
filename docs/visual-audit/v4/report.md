# V4 Screen-By-Screen Sweep

Captured against local dev at 390x844, deviceScaleFactor 3.

## Scope

- Raised visible mobile tap targets across the topbar, quick comp stack, session controls, filters, row actions, photo tools and listing controls.
- Added global pressed and focus-visible states for buttons, links, form controls and summaries.
- Made the mobile buy decision bar more prominent, with a stronger high-confidence holo treatment and clearer warning/danger backgrounds.
- Reworked comp receipt evidence rows so source tone is visible through row weight, left rail and small evidence icon, not only text labels.
- Kept the phase CSS-only. No business logic, routes, API, schema or outbound listing payloads changed.

## Screenshot Gallery

Before gallery:

- `docs/visual-audit/v4/before/v4-before-today.jpg`
- `docs/visual-audit/v4/before/v4-before-buy.jpg`
- `docs/visual-audit/v4/before/v4-before-inventory.jpg`
- `docs/visual-audit/v4/before/v4-before-listings.jpg`
- `docs/visual-audit/v4/before/v4-before-profit.jpg`
- `docs/visual-audit/v4/before/v4-before-setup.jpg`

After gallery:

- `docs/visual-audit/v4/after/v4-after-today.jpg`
- `docs/visual-audit/v4/after/v4-after-buy.jpg`
- `docs/visual-audit/v4/after/v4-after-inventory.jpg`
- `docs/visual-audit/v4/after/v4-after-listings.jpg`
- `docs/visual-audit/v4/after/v4-after-profit.jpg`
- `docs/visual-audit/v4/after/v4-after-setup.jpg`

Decision-bar after states:

- Confident: `docs/visual-audit/v4/after/v4-after-decision-confident.jpg`
- Manual-check: `docs/visual-audit/v4/after/v4-after-decision-manual-check.jpg`
- Ambiguous: `docs/visual-audit/v4/after/v4-after-decision-ambiguous.jpg`

## Playwright Measurements

Final post-change pass:

| Screen | document scrollWidth | body scrollWidth | viewport | visible small targets |
| --- | ---: | ---: | ---: | ---: |
| Today | 390 | 390 | 390 | 0 |
| Buy | 390 | 390 | 390 | 0 |
| Inventory | 390 | 390 | 390 | 0 |
| Listings | 390 | 390 | 390 | 0 |
| P&L | 390 | 390 | 390 | 0 |
| Setup | 390 | 390 | 390 | 0 |

## Notes

- The first after capture attempt used a stale production server on port 3000 and did not switch tabs; those screenshots were discarded and recaptured against a fresh `next dev` server.
- The inventory row's `More` summary was the last remaining sub-44px target and is now 44px high.
