# Visual Pass 2 Report

Date: 2026-07-04

## Scope

Visual-only pass for stacked sheets, phone Buy states, and the elevation/polish layer in `CODEX_VISUAL2_2026-07-04.md`.

Evidence captured with Playwright in Chromium and WebKit at:

- Phone: 390 x 844
- Keyboard-height phone: 390 x 500
- Desktop: 1440 x 900

Screenshots:

- Before: `docs/visual-audit/pass2/before/` (42 files)
- After: `docs/visual-audit/pass2/after/` (42 files)

## Root Causes

1. Publish confirmation overlap came from a true two-layer flow: the listing pack opened one surface, then publish added another confirmation layer. The fix turns publish into an in-sheet final step with Back/Close and a slide-to-publish control.
2. A CSS override made `.listing-pack-sheet` `position: relative`, overriding the fixed `.sell-sheet` positioning. The sheet existed, but rendered in document flow beneath the Listings page. Restored fixed positioning and raised workspaces containing sheets above app chrome.
3. WebKit retained the previous sheet scroll position when the listing pack swapped to the publish step. The publish step now resets sheet scroll to top when opened.
4. Button overflow came from horizontal action rows and missing flex/grid hygiene. Row actions now wrap/grid, action children can shrink, and long labels have bounded text behavior.
5. Buy page overlap came from the decision bar trying to hold price plus three actions in one row. The phone decision bar is now two rows: full-width price/confidence, then equal Buy/Watch/Pass targets.

## R1-R3 Proof

- R1: No second publish sheet. `stack-listing-pack-publish-confirm` now shows a single `listing-pack-publish-step` sheet in both engines.
- R2: Publish live and delete stock use `SlideConfirm`; incomplete slides snap back, disabled states are supported, pointer and keyboard confirmation work.
- R3 checklist:
  - Text children in headings, action rows, listing pack, toast, comp hero and row metadata use `min-width: 0`.
  - Buttons and action links avoid off-screen flex growth.
  - Inventory and listing row actions wrap into grids instead of hidden horizontal strips.
  - Swipe backgrounds are hidden until an actual swipe gesture.
  - Mobile decision bar no longer truncates the headline price.
  - Capture script asserted no body/document horizontal overflow; no warnings were emitted in the final after run.

## Elevation Layer

- W1: Comp receipts and listing pack sheets use card art as a blurred/darkened ambient backdrop.
- W2: Confidence chips use rarity language and styling: holo, silver, common.
- W3: Grade badges use slab-style plates for PSA/BGS/CGC/ACE/RAW.
- W4: Mobile decision bar now gives the price hero treatment with three equal thumb actions.
- W5: Added base/raised/floating surface tokens and applied them to panels and sheets.
- W6: Publish/sale toasts get small non-blocking card/coin flourish hooks.
- W7: Suggestion rows, list rows and primary actions have subtle press/highlight/fade interactions with reduced-motion support.

## Audit Punch List Fold-In

Fixed in this pass:

- Inventory More action overflow: action strips now wrap/grid.
- Desktop bottom nav overlap: wide screens make nav part of normal page flow instead of a fixed overlay.
- Buy sticky decision bar overlap/truncation: taller spacer and two-row decision layout.
- Sheet backdrop bleed-through: floating surface is fully opaque and sheet workspaces sit above app chrome.
- Duplicate sale CTA: inline sale-step card no longer repeats the footer Create sale button.
- Swipe SELL/DELETE bleed: swipe backgrounds are hidden until swiping.
- Toast over decision bar: mobile toast stack is offset above the taller decision bar.
- Smart suggestion proof: capture uses deterministic card preview rows with images, set, number, Fill and Comp.
- Placeholder/chip polish: placeholder truncation and mobile chip-row fade affordance.
- Settings checkbox: promoted-fee checkbox is aligned inline with its label.

Left as follow-up because they are interaction/product changes rather than this visual pass:

- Photos file-picker needs an in-app acknowledgement after OS picker cancellation/success.
- The non-clickable listing-flow guide could become either explicitly passive or truly interactive.
- Smart parser edge cases while rapidly typing grade-rich desktop queries need a separate parser/input handling pass.
- The "Current card / Next card" empty ghost state should be reviewed with the Buy workflow owner.

## Notes

- The "session dialog over Buy" state maps to the current always-visible Buy Session panel; there is no separate session dialog in the app today.
- WebKit was installed locally for this pass and used for every state.
- No business logic, schema, API contract or eBay payload logic was intentionally changed.
