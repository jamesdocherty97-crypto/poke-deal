# Goal: Harden and level-up Poke Deal — deal calculator, regression corpus, resilience, owned-sales loop

**For: Codex 5.5 goal mode. Self-contained. Work through the phases IN ORDER. Commit at the end of each phase with a descriptive message. If a phase's verification gate fails and you cannot fix it within that phase, STOP and report — do not proceed with a broken base.**

## Global rules
- The comp reconciler (per CODEX_RECON_SPEC_2026-07-02.md) and its 12 oracle tests are the foundation — never regress them. Existing suite (516+ tests) must stay green after every phase.
- Do not change existing source-adapter contracts. New adapters may be added.
- Verification gate for EVERY phase: `npm test` green, `npx tsc -p tsconfig.check.json --pretty false` clean, `npm run build` passes.
- All money in pence integers. All new logic pure and unit-tested where feasible.
- Do not touch eBay OAuth/credential code paths — those are blocked on external portal work.

---

## Phase 0 — Commit and clean (15 min)
1. Commit the currently uncommitted reconciler work as-is (it's verified) before touching anything else.
2. Delete root scratch: `debug_intake.mts`, `debug_parse.mts`, `debug_searchsets.mts`, `smoke_tmp.mjs`, `.next_stale_20260628205003/` — first check each debug script for anything not already covered by tests; if a probe is still useful, move it into `scripts/` with a descriptive name instead of deleting.
3. Add `.next_stale_*` and `*.tsbuildinfo` to `.gitignore`.

## Phase 1 — Buy-side deal calculator
Implement **CODEX_DEAL_CALC_2026-07-02.md** exactly (it sits next to this file): pure `dealCalc` function, settings screen, comp-receipt UI, grading-EV route, oracles D1–D10.
**Gate:** D1–D10 pass + global gates.

## Phase 2 — Live regression corpus
Lock real-world behaviour, not just synthetic oracles:
1. Create `scripts/capture-comp-fixtures.mts`: probes `/api/comps` (against a locally running dev server) for a fixed basket and writes raw JSON responses to `src/**/fixtures/comps/` (pick the idiomatic test-fixture location for this repo):
   - Umbreon + Evolving Skies, no number (must be ambiguous, 5 alternatives)
   - Charizard Base 4/102 RAW
   - Umbreon VMAX 215/203 RAW (Moonbreon)
   - Charizard ex 151 199/165 PSA 10
   - Victini SVP 208 RAW
   - Zapdos 192 from 151 (known-good from smoke)
2. Run it once and COMMIT the captured fixtures.
3. Add a test suite that feeds each fixture's source payloads through the reconciler and asserts, per card: headline within a stated band, expected confidence, expected manualCheck, ambiguity flag where applicable. Derive the bands from the fixtures you captured; comment each with the rationale (e.g. "Moonbreon: manualCheck must be true — contaminated bucket").
**Gate:** fixture tests pass; a deliberate sabotage check (temporarily invert one assertion, confirm it fails, revert) proves the tests bite.

## Phase 3 — Resilience at the fair (mobile, flaky network)
The app is used live at card fairs on mobile; a slow or failed source must never blank the screen.
1. In the comp service, fetch all sources concurrently with a per-source timeout (default 4s, config const). Use allSettled semantics: a timed-out/failed source is simply absent from the candidate list (the reconciler already handles absence honestly). Record which sources timed out in the response and show them greyed-out in the evidence panel as "source unavailable".
2. Last-known-comp cache: persist each successful comp result (headline, confidence, manualCheck, timestamp) keyed by card+grade. If a fresh lookup fails entirely, serve the cached result with a prominent "cached — Xh old" badge instead of an error. Cap cache age for display at 7 days; older → show error as now.
3. Unit tests: one source times out → headline still produced from remaining sources + unavailability recorded; all sources fail with warm cache → cached result with badge; all fail cold → clean error state.
**Gate:** tests + manually verify via a smoke run with one adapter's base URL pointed at a black-hole address.

## Phase 4 — Owned-sales logging loop
The reconciler ranks `owned-sales` as the #1 trust tier, but nothing populates it until eBay is live. Close the loop manually now:
1. Add a "Record sale" quick action on inventory/listing rows: price (pence), date (default today), channel (eBay / fair / private), optional note. Persist via Prisma following existing model conventions.
2. Feed recorded sales into the existing owned-sales adapter path so the NEXT comp lookup for that card includes them (n and recency rules per the reconciler spec: n≥3 within 120d to headline; fewer = corroboration).
3. Show the dealer's own sales as a distinct row in the evidence panel ("Your sales: 3 · median £X").
4. Tests: recorded sales appear as owned-sales candidates; 1–2 sales corroborate but don't headline; 3+ recent sales take the headline.
**Gate:** tests + global gates.

## Phase 5 — Ambiguity UX
`/api/comps` now returns `ambiguous:true` + alternatives (e.g. 5 Evolving Skies Umbreons). Make it usable one-handed at a fair:
1. When ambiguous, render the alternatives as tappable cards (name, number, thumbnail if the catalog has one, and a cheap price hint if available without extra network cost).
2. Tapping one re-runs the comp fully disambiguated (with number) — must NOT return ambiguous again.
3. Test: ambiguous response renders alternatives; selection produces a resolved comp.
**Gate:** tests + a local smoke of the Umbreon flow end-to-end.

## Phase 6 — eBay Marketplace Insights adapter, dark-launched
API access is pending eBay approval; build it now so enabling is config-only:
1. New adapter `ebay-insights` matching the existing adapter contract shape: UK sold comps → candidates with region UK, real n, ageDays. Gate behind `EBAY_INSIGHTS_ENABLED` env flag (default off); when off, the adapter is not called at all.
2. Contract tests against 2–3 mocked Marketplace Insights `item_sales/search` payloads (construct realistic samples from the API docs), asserting correct mapping to candidates and that the reconciler places an agreeing UK insights result as headline over poketrace (this is oracle T12 — extend it into an integration-shaped test).
3. Document the enable steps (env flag + credentials) in a short comment block in the adapter.
**Gate:** contract tests pass with flag on (mocked); with flag off, zero behavioural change (fixture tests from Phase 2 still byte-identical where deterministic).

## Phase 7 — Wrap-up
1. Full verification: `npm test`, tsc check, `npm run build`.
2. Update `USER_GUIDE.md`: deal calculator (incl. settings + no-quote behaviour), record-sale action, ambiguity picker, cached-comp badge.
3. Final report: per-phase summary, test count before/after, any deviations from this brief and why, and anything discovered that should become the next goal.

## Explicitly OUT of scope
- eBay OAuth/credential setup, publishing flow changes.
- Any change to reconciler thresholds/weights (calibration is a human decision).
- New price sources beyond Phase 6.
- Visual redesign beyond the specific UI items listed.
