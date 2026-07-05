# Buy Simplify Visual Audit - 2026-07-05

Scope: Phase A functional repairs, Phase B Buy-page restructure, and Phase C redundancy consolidation.

## Evidence

Before screenshots were captured from production before this deploy:

- `docs/visual-audit/buy-simplify/before/chromium-phone.png`
- `docs/visual-audit/buy-simplify/before/chromium-desktop.png`
- `docs/visual-audit/buy-simplify/before/webkit-phone.png`
- `docs/visual-audit/buy-simplify/before/webkit-desktop.png`

After screenshots were captured from the local app before deployment:

- `docs/visual-audit/buy-simplify/after/chromium-phone-result.png`
- `docs/visual-audit/buy-simplify/after/chromium-phone-evidence.png`
- `docs/visual-audit/buy-simplify/after/chromium-phone-deal-tools.png`
- `docs/visual-audit/buy-simplify/after/chromium-phone-log-comps.png`
- `docs/visual-audit/buy-simplify/after/chromium-phone-target.png`
- Same set for Chromium desktop, WebKit phone, and WebKit desktop.

Playwright measurement after the spacer fix: phone and desktop result cards start directly below the sticky topbar (`panelTop` equals `topbarBottom` in Chromium and WebKit), and the result state has no `.lookup-panel`.

## Task Table

| Task | Before - Sonnet live pass | After - Codex pass | Result |
| --- | --- | --- | --- |
| a. Type a card, read headline + confidence | 2 taps, 0 scrolls for headline, 4+ scrolls for full confidence detail | 2 taps, 0 scrolls; headline, confidence/verdict and max offer sit in the first result card | Improved |
| b. Check evidence receipt then return to price | About 9 scrolls and 1 reversal | Tap Evidence; section opens inline and auto-scrolls back to the result card | Improved |
| c. Run deal calculator | 2 taps, 0 scrolls | Tap Buy or Deal tools; cost step opens inline before commit | Preserved/improved |
| d. Log a checked comp after eBay solds | 6 taps, 2 scrolls, 1 reversal; fake opened toast | Tap Log comps; eBay opener only claims success if a tab opened, otherwise shows a tappable link | Improved |
| e. Set a buy target | 1 tap, 0 scrolls | Tap Target; target controls open inline | Preserved |
| f. Reach Just Bought It and cancel/undo | No review/cancel; immediate Stocking state could lock | Buy first opens cost step; stocking has progress, retry path, double-submit protection and Undo toast | Fixed |
| g. Scan or file upload | Camera could hang; upload input hidden | Camera times out after 8s with visible message; Upload photo instead is always visible | Fixed |
| h. Grade Lab | Stale guide label; UI did not match name | Renamed as Grading EV under Deal tools | Consolidated |

Browser regression: card A cost entered, Pass, card B comped, Buy opened cost step with an empty cost field.

Final functional regressions:

- Money state: Victini SVP 208 RAW cost `12.00` -> Pass -> Charizard ex 151 199/165 PSA 10 -> Buy opened the cost step with an empty cost field and no browser errors.
- Checked-comp input: opening Log comps and typing `10.00` into Sold price produced no React/page/console errors.

## Relocated Capabilities

Nothing was removed.

| Capability | New location |
| --- | --- |
| Confidence/verdict/manual-check detail | Confidence chip on the result card |
| Signals/spread/no-quote explanation | Confidence chip |
| Comp receipt | Evidence chip |
| PokeTrace returned signals | Evidence chip |
| UK asks/live listing context | Evidence chip |
| Card catalog/source identity strips | Evidence chip |
| Grade ladder | Evidence chip |
| Cost, quantity, listing choice and buy maths | Deal tools chip |
| Add to lot / current deal session | Deal tools chip |
| Grading EV | Deal tools chip |
| Stock reprice helper | Deal tools chip |
| eBay UK solds/manual links | Log comps chip |
| Checked comp logger | Log comps chip |
| Buy target/watch presets | Target chip |
| Full grade dropdown | More grades disclosure under the quick grade grid |
| Opening stock import and recent buys | Searching state only |

## Functional Repairs

- Cost is reset on identity changes and on new comp flows unless Quick Fill explicitly supplied a cost for that same card.
- One logged checked comp stays visible as corroboration and no longer replaces the headline client-side.
- Programmatic external opens check the returned window. Blocked opens show a tappable link instead of a false success toast.
- Scan camera startup has an 8-second timeout and visible upload fallback.
- Stocking has a visible progress row, double-submit guard, retry path, and Undo toast.
- The ghost Current/Next strip is suppressed unless there is a real card identity or image.
- Quick-cost chips keep selected state after tap.
- The old mobile sticky-action spacer no longer appears in priced result state, so the compact comp card starts directly under the topbar.
