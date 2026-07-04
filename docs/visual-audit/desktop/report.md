# Desktop Visual Audit - 2026-07-04

## Scope

Rendered every primary screen at:

- 1280 x 800
- 1440 x 900

Screens captured:

- Today / Status
- Buy
- Inventory
- Listings
- P&L
- Setup

## Before Findings

| Area | Before issue |
| --- | --- |
| Topbar | The Status button could report horizontal overflow around the alert badge. |
| Buy set chips | Long popular/recent set chip rows could extend offscreen on wide desktop captures. |
| Wide Buy layout | With no active comp result, the right column felt underused. |

## After Result

| Viewport | Screens checked | Horizontal overflow |
| --- | ---: | ---: |
| 1280 x 800 | 6 | 0 |
| 1440 x 900 | 6 | 0 |

The after metrics are stored in `docs/visual-audit/desktop/after/desktop-after-metrics.json`.

## Files

Before screenshots:

- `docs/visual-audit/desktop/before/desktop-before-1280x800-*.jpg`
- `docs/visual-audit/desktop/before/desktop-before-1440x900-*.jpg`

After screenshots:

- `docs/visual-audit/desktop/after/desktop-after-1280x800-*.jpg`
- `docs/visual-audit/desktop/after/desktop-after-1440x900-*.jpg`

## Changes Made

- Gave topbar secondary buttons stable desktop width and padding.
- Let desktop chip rows wrap instead of producing hidden sideways overflow.
- Added wide-desktop Buy column placement for stock import and recent buys.
- Kept mobile horizontal chip scrolling intact.

