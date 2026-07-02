# Goal: Ship to production, verify live, then Deal Sessions + P&L — the dealer workflow layer

**For: Codex 5.5 goal mode. Self-contained. Phases IN ORDER, commit per phase, push where instructed. If a verification gate fails and you can't fix it within the phase, STOP and report.**

Context: the comp reconciler, deal calculator, resilience layer, owned-sales logging, ambiguity picker, and dark-launched eBay Insights adapter are all built and green locally (543 tests) but UNPUSHED — production still runs the old, broken reconciler. This goal ships it, proves it live, then builds the layer that turns single-card comps into how dealers actually work: whole-lot negotiations and knowing whether they made money.

## Global rules
- Never regress: existing 543 tests, the 12 reconciler oracles, D1–D10 deal-calc oracles, and the Phase-2 live fixtures must stay green after every phase.
- Gates for every phase: `npm test`, `npx tsc -p tsconfig.check.json --pretty false`, `npm run build`.
- Money = pence integers. New business logic pure and unit-tested.
- Do not touch eBay OAuth/credential paths (blocked on external portal work) and do not change reconciler/deal-calc thresholds (calibration is the dealer's job).
- The user has authorized pushing to `main` (deploys to Vercel production).

---

## Phase A — Ship and verify production (do this first, alone, before any new code)
1. `git push` the 12 pending commits. Wait for/confirm the Vercel deployment of that commit (e.g. poll the site or check the deployed build responds).
2. Create `scripts/verify-prod.mts` — a repeatable post-deploy smoke that probes `${BASE_URL:-https://poke-deal.vercel.app}/api/comps` for the canonical basket and asserts:
   - Umbreon + Evolving Skies, no number → `ambiguous: true` with 5 alternatives (NOT a £116 headline).
   - Charizard Base 4/102 RAW → headline in £150–£400 band; evidence contains NO Cardmarket trendPrice ≈ £3,576 and NO wrong-card £153 PokeTrace row.
   - Umbreon VMAX 215/203 RAW → `manualCheck: true` with non-empty reasons.
   - Charizard ex 151 199/165 PSA 10 → trend is null/absent (no +297.9%), confidence medium.
   - Victini SVP 208 RAW → headline ≈ £12–14, confidence high, manualCheck false (the don't-regress control).
   Exit non-zero with a readable per-card PASS/FAIL table. Add `npm run verify:prod`.
3. Run it against production. **GATE: all five pass.** If a card fails: diagnose whether it's an env/config difference (missing Vercel env var, stale cache) — fix and redeploy if so; if it's a logic difference between local and prod behaviour you cannot explain, STOP and report with the raw JSON for that card.
4. Commit the script.

## Phase B — Deal Sessions (lot/binder mode) — the headline feature of this goal
Dealers rarely buy one card; they negotiate a binder or a lot. Today the app prices cards one at a time and the dealer sums offers in their head. Build a session cart:

1. **Model** (Prisma, follow existing conventions): `DealSession { id, name (default "Session <date>"), createdAt, status: open|completed|abandoned }` and `DealSessionLine { sessionId, card identity (setId/number/name/gradeBucket), headlinePence, confidence, manualCheck, maxCashOfferPence?, maxTradeOfferPence?, dealerOfferPence? (manual override), addedAt }`. Snapshot the comp values onto the line at add-time — a session must not silently change as market data moves.
2. **Flow**: on any comp result, an "Add to session" action (creates/reuses the single open session). A session screen lists lines with per-line offer, override field, and remove.
3. **Aggregates** (pure function, unit-tested): total max cash, total max trade, expected proceeds, expected profit. Lines with `manualCheck` or no-quote are INCLUDED in the list but EXCLUDED from auto totals, with a prominent banner: "N cards excluded from totals — check manually". Suggested bundle offer = total rounded DOWN to nearest £5 (< £100 total) or £10 (≥ £100).
4. **Completion**: "Complete purchase" asks one number — what was actually paid for the lot — then allocates that cost across lines proportional to each line's maxCashOffer (manual-check lines: proportional to dealer-entered override, which becomes required for included lines at completion). Each line becomes/updates an inventory item with `costPence` = its allocation. This cost basis is what Phase C consumes.
5. **Tests**: aggregate math incl. exclusions and rounding; proportional cost allocation (must sum exactly to the paid total — distribute remainder pence deterministically to the largest line); completion creates inventory with correct cost basis; snapshot immutability (re-pricing a card later does not alter an existing session line).

## Phase C — Simple P&L (did I actually make money?)
Owned-sales logging (Record sale) and Phase-B cost basis now exist; connect them:
1. Per inventory item: realized profit = recorded sale price − estimated selling fees (reuse the deal-calc fee model/settings — do not duplicate the fee math) − costPence. Show on the item and in the "Your sales" evidence row.
2. A P&L view: totals by month and by channel (eBay/fair/private) — revenue, cost, fees, profit; plus current stock at cost (sum of unsold items' costPence). Keep it one screen, no charts required; a simple table is fine.
3. Items with no cost basis (pre-existing stock) show profit as "—" with a one-tap "set cost" affordance, never a fake number that assumes zero cost.
4. Tests: fee model reuse, month/channel grouping, missing-cost handling.

## Phase D — Pre-fair comp warm-up
Phase-3 caching serves stale comps when the network dies at a fair; make sure the cache is WARM going in:
1. "Refresh all comps" action (inventory screen) + `npm run warm-comps` script: iterate in-stock inventory items, run each through the comp pipeline, concurrency-limited to 3, per-item timeout, and STOP at a hard cap of 100 items per run (log what was skipped — no silent truncation). Show progress and a summary (refreshed / failed / skipped).
2. On inventory rows, show comp age ("priced 3d ago") and an amber marker beyond 7 days.
3. Tests: concurrency cap respected (no more than 3 in flight), failures don't abort the run, cap + skip logging.

## Phase E — Wrap-up
1. Full gates. Run `npm run verify:prod` once more after the final push (Phases B–D are additive; the basket must still pass byte-for-byte on the five assertions).
2. Update USER_GUIDE.md: deal sessions (incl. why manual-check lines are excluded from totals), completing a purchase and cost allocation, P&L view, comp warm-up.
3. Push. Final report: per-phase summary, test count before/after, deviations and why, and the top 3 things you noticed that should shape the next goal.

## Explicitly OUT of scope
- eBay OAuth/credentials, publishing changes, Marketplace Insights enablement (awaiting eBay approval).
- Reconciler/deal-calc threshold changes.
- Multi-user/auth, charts/analytics beyond the P&L table, photo intake.
