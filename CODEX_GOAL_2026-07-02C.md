# Goal: Make it feel fast and decisive — monolith split, perceived speed, one-glance buy decision

**For: Codex 5.5 goal mode. Self-contained. Phases IN ORDER, commit per phase (Phase 1 commits per-tab), push at the end and run `npm run verify:prod`. If a gate fails and you can't fix it in-phase, STOP and report.**

Priority note: if CODEX_GOAL_2026-07-02B Phases B–D (deal sessions / warm-up) are unfinished, PARK them — this goal takes priority and must not be interleaved with them. Resume B afterwards.

Context: the app works and the pricing brain is trustworthy, but `src/app/page.tsx` is ~10,100 lines — the entire UI in one client component — and the core buying flow is 9 sequential steps down a long scroll. This goal is pure user-perceivable quality: open faster, respond faster, decide in one glance. NO pricing/business-logic changes anywhere in this goal.

## Global rules
- All existing tests, reconciler/deal-calc oracles, live fixtures, and `npm run verify:prod` (five-card basket) must pass after every phase.
- Gates per phase: `npm test`, `npx tsc -p tsconfig.check.json --pretty false`, `npm run build`.
- This is a UI/architecture goal: do not modify anything under `src/lib/comps`, `src/lib/dealer`, or any adapter/reconciler/deal-calc logic. API route changes only where a phase explicitly says so.
- Mobile-first: the primary device is an iPhone PWA used one-handed at a card fair. Touch targets ≥ 44px. Test at 390px width.

---

## Phase 1 — Split the monolith (the foundation; invisible diff, immediately felt)
Goal: `page.tsx` becomes a thin shell (< ~400 lines) that renders five tab components; everything else moves to `src/app/components/` (or the repo's idiomatic location).

Method — MECHANICAL EXTRACTION, zero behavior change:
1. First, record baselines: `npm run build` route sizes (First Load JS) and the line count. Report before/after at the end.
2. Extract one bottom-nav tab at a time — Today, Buy, Stock, List, Profit — each as its own component file, plus shared pieces (sheets, comp receipt, deal calc panel, sale sheet, etc.) as they naturally separate. One commit per tab.
3. State: keep it working with minimal restructuring — lift genuinely shared state into a small context or keep it in the shell passing props. Do NOT redesign state management, do NOT rename things, do NOT "improve" logic while moving it. If you spot a bug while moving code, note it in the report; don't fix it in the same commit.
4. Convert tabs to lazy-loaded (dynamic import / React.lazy) so first paint only pays for the active tab. Keep the shell + Today eager.
5. Memoize the expensive list rows (stock/listing rows) so typing in a search box doesn't re-render every row. Only add memoization where a render is measurably repeated — don't scatter useMemo everywhere.
**Gate:** builds green; a manual smoke of ALL five tabs and their key sheets (comp lookup, edit stock, mark sold, create listing, delete confirm) against the dev server; First Load JS reduced (report the number); zero intended behavior changes.

## Phase 2 — Perceived speed on the Buy flow
The comp takes seconds (multiple upstream APIs); make the wait feel active and short:
1. **Instant identity**: the moment a card is resolved (catalog match is fast), render the card art, name, set, number immediately — before comps return. The dealer confirms "right card" while sources load.
2. **Staged skeleton**: replace any blank/spinner wait with a receipt skeleton that fills in as data arrives; if the API returns in one shot today, split the UI rendering into identity-first then comp (only touch the /api/comps route if it's trivial to return identity fields early; otherwise fake the staging client-side from the catalog lookup you already have).
3. **Stale-while-revalidate comps**: if a cached comp exists for card+grade (Phase-3 cache from the resilience goal), show it INSTANTLY with the cached badge and age, and refresh in the background, swapping in the fresh result with a subtle "updated" pulse. The dealer starts reading numbers at 0ms instead of staring at a spinner.
4. **Optimistic writes**: "Just Bought It", "Mark Sold", "Record sale", watch creation — update the UI immediately, reconcile on server response, roll back with a visible error toast on failure. No full-page refetches after a write; update the local row.
5. Debounce search inputs (stock/listing search) so filtering feels instant, not laggy.
**Gate:** manual smoke with network throttled to Fast 3G in devtools: identity appears < 1s after resolve, no blank states, cached comp path renders instantly for a previously-comped card.

## Phase 3 — The Decision Bar: comp → decision in one glance
Collapse the 9-step fair flow. After a comp resolves, render a sticky bottom decision bar (above the nav) on the Buy tab:
1. Contents, one line each: **headline price + confidence chip + verdict word** (Usable/Thin/Cross-check/Manual/Catalog-only, color-coded); **"Max offer £X cash / £Y trade"** from the deal calculator (or the no-quote reason, compact); three buttons: **Buy** / **Watch** / **Pass**.
2. **Buy** opens the Just-Bought-It sheet pre-filled: cost field focused with numeric keyboard, channel + strategy defaulted from the dealer's most-recently-used values. One number + one tap stocks the card. The Deal Judge verdict (Buy/Watch/Pass at the entered cost) shows INSIDE this sheet, live as the cost is typed — not as a separate step.
3. **Watch** creates the buy watch with the already-suggested target in one tap (editable after via the existing UI). **Pass** clears the comp and returns focus to Quick Fill for the next card, ready to type.
4. The full receipt/evidence remains below in the scroll for when the dealer wants depth — the bar is a summary, not a replacement. manualCheck comps: Buy button becomes "Check first" style (still tappable, but visually demoted; keep the existing no-quote honesty).
5. Target: a routine buy at a fair = Quick Fill line → Fill → Run Comp → glance at bar → Buy → type cost → confirm. Count the taps before/after and report.
**Gate:** manual smoke of buy/watch/pass paths incl. a manualCheck card; existing tests green.

## Phase 4 — Today becomes a command center
Today should answer "what should I do right now?" with tappable items, not static text:
1. Replace/augment the current Today content with a prioritized queue built from data that already exists (reuse existing endpoints; add one aggregate route only if needed): watches at/below target ("Umbreon hit £X — view"), stock with no listing ("3 cards unlisted — list them"), stale comps on active stock (>7d, from the warm-up work), drafts not activated, this week's profit one-liner.
2. Each item is one tap deep: tapping navigates to the right tab with the relevant item focused/filtered.
3. Empty state when nothing needs doing: show the week's numbers and a "Run comp" shortcut — the app should feel DONE, not blank.
4. Keep Setup health visible but demoted below the queue.
**Gate:** items navigate correctly; empty state renders when queues are empty; tests green.

## Phase 5 — Feel polish sweep
Small, cheap, everywhere-felt. Apply app-wide:
1. Every mutating button gets pressed/loading/disabled states (no double-submit; no dead-feeling taps).
2. Toasts for every write success/failure (one consistent component) instead of silent success.
3. Consistent empty states for every list (stock, listings, sales, watches, costs) with a one-line "what to do first".
4. Error states that say what failed and offer retry — never a raw error string or a blank panel.
5. Keyboard/entry niceties: numeric inputmode on all money fields; enter-to-submit on Quick Fill; set-autocomplete arrow-key + enter navigation (already flagged in USER_GUIDE as outstanding).
6. Respect safe-area insets for the sticky bar + bottom nav on iPhone (env(safe-area-inset-bottom)).
**Gate:** visual smoke at 390px; tests green.

## Phase 6 — Ship and report
1. Full gates + push + confirm deploy + `npm run verify:prod` (all five PASS).
2. Update USER_GUIDE.md: the new fair flow (decision bar), Today queue, and any changed navigation.
3. Report: bundle before/after (First Load JS, per-route), page.tsx line count before/after, tap-count for a routine fair buy before/after, and the top 3 UX debts you saw but didn't touch.

## Explicitly OUT of scope
- Any change to reconciler, deal calc, adapters, or their thresholds/tests.
- New data sources, eBay OAuth, push notifications.
- Visual rebrand/theme changes — this is flow and responsiveness, not aesthetics.
- State-management library adoption (no Redux/Zustand/etc.) — structure only.
