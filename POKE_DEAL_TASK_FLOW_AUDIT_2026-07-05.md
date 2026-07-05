# Poke Deal — Buy Page Task-Flow & Dead-Control Audit

**Date:** 2026-07-05
**Method:** Live click-through of the Buy page at https://poke-deal.vercel.app in Chrome device mode. Observation only — no destructive confirm was ever accepted; every stock/comp action taken was a normal, reversible in-app action (adding one card to stock was required to reach post-buy states, matching the brief's own tasks).
**Viewport:** ~606×723–606×1203 (devicePixelRatio 2). The environment's `resize_window` tool does not hold the literal 390×844 requested; this is the same documented limitation as the prior visual-bug audit for this app.
**Cards used:** Pikachu, Crown Zenith Galarian Gallery GG30/GG70, PSA 9 (graded path) and Charizard ex, Obsidian Flames 125/197, RAW (raw path).

---

## Part 1 — Task cost table

Nondeterministic comp resolution is the single biggest cost driver in this app: identical actions can return a price in ~2 seconds or hang on a placeholder state for 10–20+ seconds with zero loading indicator, so "taps" is a more stable unit than time. Where a step's completion time is genuinely variable, that is called out in the notes rather than folded into a single number.

| # | Task | Taps | Scrolls | Reversals | Notes |
|---|------|------|---------|-----------|-------|
| a | Type a card, read headline + confidence | 2 (search field, Comp) | 0 to see headline+tier; +4 to reach the actual "Signals X/5" confidence detail | 0 | Headline price and tier ("Common · Manual check £4.21") render immediately above the fold. The only literal confidence figure ("Signals 3/5 · 181% spread · ceiling £3.06") lives ~4 full screens further down, past the grade grid and buy-session config, with no shortcut to it. |
| b | Same, then check the evidence receipt, then return to price | 2 (same as a) | ~9 total (≈5 down to reach the "UK asks (live)" evidence list, ≈5 back up to the price) | 1 (the return trip) | No "back to top" or anchor control exists; returning to the price is a plain manual scroll-up with no shortcut. |
| c | Run the deal calculator on the comp | 2 (Buy, then a Target/Safe/Half-list chip — or manual Cost entry) | 0 | 0 | Add-cost panel opens directly under the sticky price bar; Profit/Return recalculate live as Cost changes. Cleanest flow measured in this audit. |
| d | Log a checked comp after opening the eBay solds link | 6 (Log what you saw → Open UK solds → dismiss resulting toast → tap Sold price field → Log price → Done) | 2 | 1 | "Open UK solds" never opens a real tab (see Part 2 #29). Dismissing its toast reflows the layout and shifts the Sold price field, so the field has to be re-located before it can be tapped — this is the reversal. |
| e | Set a buy target | 1 (tap a Target/Safe/Half-list chip, Add-cost panel already open) | 0 | 0 | Confirmed mechanism: tapping "Target £X" fills the Cost field with that suggested buy price and live-updates Profit. Cheapest task measured. |
| f | Reach "Just Bought It" and cancel | — | — | — | **Not reachable as specified.** No confirmation/review screen exists between tapping "Buy" and the purchase committing. One tap on "Buy" transitions straight to a "Stocking…" state (observed 2–14+ seconds, no fixed duration, no progress indicator) during which Watch and Pass are both disabled and there is no cancel control anywhere. The only way to avoid buying is to tap "Pass" *before* tapping "Buy" in the first place. |
| g | Scan a card (camera or file) and read result | 2 (Scan, then the shutter) | 0 | 0 | **Task not completable.** The camera sheet opens but the preview never advances past "Opening camera…" — no video frame, no error, no timeout, no fallback message (confirmed via console: zero permission/camera errors logged). The shutter button is tappable but produces no response. A hidden `<input type="file" accept="image/*">` exists in the page's DOM, but it has no visible button, label, or link anywhere in the sheet — so the "or file" path implied by the brief is not reachable by any on-screen control. |
| h | Use Grade Lab | — | — | — | **Feature does not exist.** Searched literal page text on all five tabs (Buy, Inventory, Listings, P&L, Setup); no "Grade Lab" label anywhere. The closest analog is the RAW–CGC10 grade-selector button grid on the Buy page, which is not named or badged as "Grade Lab" anywhere in the UI. |

---

## Part 2 — Dead / broken controls census

Numbered continuously. Each entry names the state it was found in.

### Empty state (no query typed)

**21.** "Comp" button is correctly disabled (greyed, no-op on tap) with an empty query — verified working-as-intended, included for completeness.

**22.** "Next" is enabled even with an empty query and nothing queued; tapping it produces a "Ready for next comp." toast with no visible effect on the page — an enabled control whose purpose is unclear in this state.

**23.** "Scan card with camera" opens a sheet that hangs indefinitely on "Opening camera…" with a permanently black preview frame. The circular shutter button remains tappable throughout but produces no response, no error, and no timeout/fallback messaging. Console logging showed zero camera- or permission-related errors — the underlying camera request appears to simply never resolve or reject.

**24.** A hidden `<input type="file" accept="image/*">` sits in the scan sheet's markup but is not wired to any visible button, label, or link — the file-upload fallback a user would reasonably expect ("scan with camera *or* upload a photo") is present in code but undiscoverable and untappable in the UI.

**25.** A leftover "Current card / Next card" ghost entry (a grade badge such as "PSA 9" or "CGC 1 5" with no card name and an empty image placeholder) reappears in the empty state after a comp resolves and the search field is cleared. Reproduced twice independently in this session — confirms finding #18 from the prior visual-bug audit is a repeatable defect, not a one-off render glitch.

### Comp-resolved (raw) state — e.g. Charizard ex, Obsidian Flames, RAW → "Common · Manual check £4.21"

**26.** Typing into the "Sold price" field of the "Log what you saw" checked-comps panel threw a React error twice in immediate succession in the browser console (minified React error #185 — "Maximum update depth exceeded," i.e. an infinite re-render loop triggered from that field's onChange handler). The UI did not visibly freeze or crash, but the error is real, reproducible in this session, and surfaces nothing to the user — no toast, no console-free confirmation that anything went wrong.

**27.** Logging a single manual "checked comp" price does not merge with or average against the existing auto comp — it fully replaces the sticky headline price and downgrades the confidence tier. Observed directly: "Silver · Single graded £37.44" became "Silver · Thin £36.50" the instant one £36.50 manual entry was logged, with no way to see or restore the original multi-point auto comp afterward.

**28.** "Open UK solds" shows a success toast ("Opened eBay UK solds. Log the sold prices when you are back.") but does not open any new tab or window — confirmed twice by diffing the full browser tab list immediately before and after tapping it. The user is told an external page was opened when nothing was opened.

**29.** Dismissing that toast (tapping its ✕) reflows the layout beneath it, shifting the "Sold price" field and its siblings out of the screen position they held a moment earlier. A tap aimed at the field's pre-dismiss position lands on empty space instead — reproduced directly in this session and is the source of the reversal counted in Part 1d.

**30.** The "Manual check" confidence warning ("Signals 3/5 · 181% spread · ceiling £3.06 · do not trust one number") sits roughly 4–5 full screens below the sticky price bar it qualifies, with no summary chip, anchor link, or "why is this Thin/low-confidence" shortcut near the headline itself.

**31.** Tapping "Buy" is inconsistent: sometimes it opens the "Add cost" panel (Target/Safe/Half-list shortcuts, live Profit calc); other times — observed when a Cost value was already held in state from a prior comp earlier in the same session — it skips the cost step entirely and goes straight to "Stocking…", silently reusing a cost value that belonged to a different card/price.

**32.** The "Stocking…" commit state has no fixed duration (observed 2–14+ seconds across repeated tests on the same action) and disables both Watch and Pass for its entire length, with no progress indicator, no error path if something goes wrong, and no cancel control at any point — this is the direct answer to Part 1f.

### Comp-resolved (graded) state — e.g. Pikachu PSA 9 → "Silver · Single graded £37.44"

**33.** Same "Open UK solds" fake-open behavior (see #28) reproduced independently in the graded-comp state.

**34.** Same Buy → immediate "Stocking…" skip-the-cost-step behavior (see #31) reproduced independently in the graded state.

**35.** The Target/Safe/Half-list chips give no lasting visual indication of which one (if any) was tapped — after tapping "Target £22.20," the chip does not stay highlighted/selected, so a user glancing back at the panel can't tell whether the current Cost value came from a chip or was typed by hand.

### Suggestions-open / ambiguous states

**36.** Not independently reproduced with fresh evidence this session — flagged as an open item rather than invented. The prior visual-bug audit already documented one instance of a dropped keystroke while an autosuggest card was mounting mid-type (its finding #13); this session did not encounter a genuine multi-candidate disambiguation UI (e.g. searching a bare Pokémon name with no set), so it's unconfirmed whether the app ever presents a picker versus silently guessing a single match. Recommend a follow-up manual pass specifically targeting deliberately vague queries.

---

## Part 3 — Redundancy list

1. **Verdict panel vs. Manual-check confidence panel.** Both independently warn the user not to trust the current price for the same comp — the Verdict card ("Check — maths works, but the comp needs a second look before committing hard") and the separate Manual-check panel ("Signals 3/5 … do not trust one number") — in different locations on the same screen, with no cross-reference linking them.

2. **Sticky headline price vs. Verdict's "Expected sale."** The sticky bottom bar shows one large currency figure (the buy-side headline, e.g. "£4.21") and the Verdict panel shows another large currency figure a few screens up (the sell-side "Expected sale," e.g. "£42.43" in an earlier test) — both rendered in the same bold yellow/white price styling, inviting confusion between "what I'd pay" and "what I'd sell it for."

3. **Two separate "open eBay" actions for the same card.** "Open UK solds" inside "Your checked comps" and the "eBay UK" button inside the separate "Manual checks" external-link row both claim to send the user to eBay UK for the same listing — from two different panels, with no indication they point at the same destination (and, per finding #28, neither one actually opens anything).

4. **Quick-cost chips vs. free-text Cost field.** Target/Safe/Half-list chips and the manual Cost input both set the same single value; once tapped, a chip gives no persistent selected/active state, so the two input paths are indistinguishable after the fact (see finding #35).

5. **Grade-shortcut grid vs. Full grade list dropdown.** The RAW/PSA-8/PSA-9…/CGC-10 button grid ("Recent comps") and the separate "Full grade list" dropdown in the manual-entry section both set the same GRADE field via two different UI patterns (quick-tap buttons vs. exhaustive dropdown), with no visible sync confirmation that the two stay in agreement.
