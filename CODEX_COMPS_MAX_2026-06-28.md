# Codex — Make Comping & Searching the Best It Can Be (2026-06-28)

Single objective: **extract the absolute maximum signal from every API we already pay for or can access, then reconcile it into one trustworthy number with honest confidence.** This is not a redesign — the contracts (`CompSource`, `CompService`, `cleaning.ts`, `InventoryRepo`, `acquireToInventory`) stay. We are mining unused fields, not rebuilding.

Money stays GBP pence below the adapter boundary. Sources degrade, never throw. Add fixture tests for every new field you parse.

---

## Method — do this for EACH API before writing mapping code

The docs lie and plan tiers differ. For every source below:

1. **Probe live once** with a real card and **capture the raw JSON to a fixture** (`src/lib/comps/sources/__fixtures__/` pattern already exists). Build the parser against what you actually received, not the docs.
2. **Confirm our actual plan tier** (Price Tracker, PokeTrace) from the dashboard — it determines which fields/history depths exist. Note the tier in a comment.
3. Map every useful field. Anything you deliberately skip, leave a `// TODO(field): why skipped` so it's visible, not silently dropped.

---

## 1. Pokémon TCG API — the biggest free lever (no extra requests)

`readCatalogPriceSignals` already extracts tcgplayer variants + Cardmarket fields. The gaps are in *how* that data is used, and they're costing accuracy:

- **Variant is auto-picked by priority, not by the actual card.** `priceSignalPriority` ranks `holofoil` (20) far above `reverseHolofoil` (4), so a **reverse-holo card silently gets priced at the holofoil number** — often a 2–5× error. Fix: thread a **printing/variant choice** (Holo / Reverse Holo / Normal / 1st-Ed Holo / 1st-Ed Normal) from the buy form into `pickCatalogPriceSignalForRequest`, the same way 1st-edition is already handled. Default to the printing that matches the card's rarity when unambiguous; otherwise let the user pick. This is the #1 accuracy fix in the whole app and it's free.
- **`trendPct` is null when Cardmarket hands you the trend for free.** Cardmarket prices include `avg1`, `avg7`, `avg30`. Compute `trendPct = (avg7 − avg30) / avg30` (or avg1 vs avg7) and populate it. Real momentum, zero extra calls.
- **Rich data collapses to one number (sampleSize 1).** Surface the **full signal set** you already collect (TCGPlayer market vs Cardmarket trend vs avg30, and per-variant) so the UI can show a baseline range and the reconciler can cross-check. Keep one headline, but stop discarding the rest.
- **Cardmarket is the UK-relevant anchor** — it's already prioritized over TCGPlayer (good). Make sure `lowPrice` vs `trendPrice` vs `avg30` spread feeds the disagreement signal (a wide Cardmarket internal spread = thin/volatile market = lower confidence).

## 2. Pokémon Price Tracker — one fetch, every grade, real trend, blended price

The v2 `salesByGrade` payload **already contains every grade in a single response**, but we map only the one requested grade and re-fetch per grade. Mine the whole thing:

- **Fetch once → cache the entire `salesByGrade` block** (RAW + every PSA/BGS/CGC bucket) keyed by card+day. Serve all grades and grade-switching from cache. One credit instead of N, and it powers the price ladder in §8.
- **Read the top-level blended `prices` block** (currently unread) as a second cross-marketplace number for the disagreement check.
- **Real `trendPct`** — pull `includeHistory`/`days` (confirm the exact param against your account) and compute a true % over the window; the code comment already flags this as deferred.
- **Confirm the plan tier.** Tiers differ on history depth (3-day Free / 6-month / 12-month+) and the Business tier exposes **population reports (PSA/CGC/BGS pop counts)**. Probe `/api/v2/cards` and record what your key actually returns. If pop is available on your tier, wire it into graded confidence (§5/§7).
- Keep `limit=1` (credits are charged on `limit`). Lean on the persisted `CompResult` cache so the same card same-day never re-charges.

## 3. PokeTrace — map everything the tier gives, gate the rest behind tier

- Probe the free-tier response and **map every field it returns** (US TCGPlayer/eBay RAW baseline + sample size). Make sure nothing is dropped.
- **Feature-flag by tier:** when PokeTrace Pro is enabled it returns **EU/Cardmarket baselines + graded data**. Write the adapter so those fields are consumed the moment the key tier changes — no code change needed at upgrade time. (See §9: Pro is the one paid upgrade worth it for a UK dealer, because it's the only graded *cross-check* we'd have.)
- Today PokeTrace is the EU-first RAW second opinion; make the EU/Cardmarket path the *preferred* RAW baseline for UK when present (it already is in `preferredRawBaseline` — verify it fires).

## 4. PSA Public API — stop wasting the population data

PSA currently only prefills the form. It fetches `totalPopulation` and `populationHigher` and throws them away.

- **Surface population on every graded comp** as scarcity context: `populationHigher: 0` = "none graded higher" (premium); a large `totalPopulation` = commodity. Show it next to the graded price.
- **Feed pop into graded confidence** (§7): low pop + low pop-higher should *raise* confidence in a strong price; huge pop should widen the expected range.
- **Use PSA as an identity cross-check** for graded buys — compare its subject/year/number against the catalog match and warn on mismatch.
- Limitation to accept: PSA pop is **cert-keyed only** — you can't fetch pop for a card you don't hold a cert for. So pop enriches *slabs in hand*, not speculative graded comps. Note it; don't fight it.

## 5. Owned sales — weight it highest, add velocity

Nothing is a better comp than what *you* actually sold the exact card for.

- **Weight owned sales above external sources** in reconciliation when the identity matches (same `tcgApiId` + grade). Make sure sales are booked with the locked catalog ID so they match back (tie-in with the identity-lock work already shipped).
- Surface **sell-through velocity** (how fast it sold), not just price — a card that sold in 2 days at £X is a stronger signal than one that sat 90 days.
- Use realized margin vs the comp at buy-time to **calibrate** future verdicts ("your comps have run ~8% optimistic on this set").

## 6. eBay — tune the manual query, and the real upgrade path

- **Manual query recall** (the fallback you actually tap): when a unique collector number is present, use the **short set alias** (`TG`, `GG`, `151`) or make the set name optional rather than injecting long descriptive names (`"Lost Origin Trainer Gallery"`) that sellers don't title with. Long set names quietly drop real sold listings. A/B a few of James's real cards for recall before locking.
- **Upgrade path — eBay Marketplace Insights API**: this is the only way to get **programmatic UK eBay *sold* comps** (last 90 days) directly, instead of bouncing the user to a manual search. It's access-gated (requires application/approval), but it's the single biggest accuracy upgrade possible for a UK dealer — it turns the manual fallback into a real automated UK sold-comp source. Apply for access; build the adapter behind a `CompSource` when granted.

## 7. Cross-cutting — turn many signals into one trustworthy number

- **Live FX, daily-cached.** `currency.ts` uses static USD/EUR→GBP rates. Every Price Tracker (USD) and Cardmarket (EUR) number silently drifts when rates move. Wire a daily-cached FX provider (the backlog already notes this). This affects *every* comp.
- **Unified confidence model.** Today confidence is per-source. Blend: total sample across sources, source agreement, recency (`asOf` staleness), variant-match certainty, and PSA pop for graded. Output one honest confidence the verdict uses.
- **UK-weighted reconciliation.** For a UK dealer, weight Cardmarket / eBay-UK-sold / owned sales above US TCGPlayer. Confirm `pickRawHeadline`/`preferredRawBaseline` already lean this way and extend the weighting to graded.
- **Single-fetch, multi-grade cache + credit budget.** One card lookup should fan out to PPT (all grades), TCG API (all variants), PokeTrace, owned sales — then cache the whole bundle for the day. Never re-charge a paid source for the same card same day.

## 8. The payoff UI: a price ladder

Once §1–2 are mined, one lookup has the data to show a **full grade/printing ladder from a single fetch**: RAW (Holo / Reverse / 1st-Ed) → PSA 8/9/10 → BGS 9.5 → CGC, each with price, sample, source, confidence, and pop where available. That's the dealer's dream surface and it costs no extra API calls — it's just displaying what one cached bundle already contains.

---

## 9. Paid upgrade decisions (only after the free wins above)

1. **Free first** — variant-aware pricing, Cardmarket trend %, PPT blended price + all-grades cache, PSA pop. These are paid-for-but-dark today and move accuracy more than any subscription.
2. **PokeTrace Pro (~$19.99/mo)** — the one upgrade worth it now: EU/Cardmarket RAW baseline (UK-relevant) **and** the only graded *cross-check* we'd have. De-risks the highest-value buys.
3. **eBay Marketplace Insights API (access-gated, free to apply)** — apply now; it's the ultimate UK sold-comp source. No monthly cost, just approval lead time.
4. **Defer Price Tracker Business ($99/mo)** until graded volume justifies built-in pop + 12-month history; PokeTrace Pro + free PSA pop cover most of it for a fraction of the cost.

---

## Verification / acceptance

- Each new field parsed has a **captured-fixture test**; `npm test` + `tsc -p tsconfig.check.json` + `npm run build` green.
- A **reverse-holo** card no longer shows the holofoil price; a printing selector drives the baseline.
- `trendPct` is a real number for cards with Cardmarket avg data.
- One lookup returns a **multi-grade bundle** from a single PPT credit (verify via logs / credit count).
- Graded comps show **PSA population** when a cert is present.
- FX is live-cached (flip the rate, see comps move).
- Live-smoke 5 of James's real cards end to end and eyeball that the headline + ladder match reality.

## Don't

- Don't break fixture mode (must run with no keys).
- Don't re-charge paid sources for the same card same day — cache.
- Don't collapse variant/printing differences into one number — that's the core accuracy bug.
- Don't trust docs over a captured live response.
- Don't change the core contracts to avoid work — flag it instead.

---

## Status tracker — eBay Marketplace Insights access (added 2026-06-28)

**Submitted.** Application Growth Check request filed on the eBay Developers Program.
- **Ticket ref:** `260628-000019` — Subject "Pokemon Dealer OS — Marketplace Insights API access for UK sold-price valuation"
- **Type:** App Check · **Status at submit:** Updated · **Created:** 2026-06-28
- **Track it:** developer.ebay.com → Support → Developer Technical Support → **My Tickets**. eBay replies on this ticket; reviews run on a backlog (days–weeks).
- **Why it matters:** this is the only route to programmatic UK eBay *sold* comps (last 90 days, `getItemSales`). It would turn the manual eBay fallback into a real automated `CompSource` (§6). Approval not guaranteed — eBay reserves MI for vetted/active apps.

**Two prerequisites to satisfy while it's pending (common auto-reject reasons):**
1. **Subscribe the keyset to eBay Marketplace Account Deletion notifications** — eBay states this is required for compliance before granting restricted access. Verify/enable on the app's keyset (the Notification API marketplace-account-deletion endpoint). The app already has eBay OAuth wired in `src/lib/ebay/`, so add/confirm the deletion-notification handler + endpoint.
2. **Generate real eBay API usage** — eBay won't approve apps "in beta or with no usage." Drive some live calls (e.g. Browse API) so the app shows genuine traffic ahead of review.

**Rollout path now implemented:** `EbayMarketplaceInsightsSource implements CompSource` and is wired into the app comp service/status page behind `EBAY_MARKETPLACE_INSIGHTS_ENABLED=true`.
- Keep `EBAY_MARKETPLACE_INSIGHTS_ENABLED=false` until eBay grants restricted access.
- After approval, enable it in Vercel and redeploy. If the source returns 401/403 in `raw.reason`, the code is live but eBay has not granted the keyset the restricted MI permission yet.
- It queries `EBAY_GB`, Pokemon single-card category `183454`, last-90-days solds, uses human grade wording (`PSA 10`, `ACE 10`, `BGS 9.5`), and keeps RAW manual-query exclusions aligned with the working UK eBay fallback.
- Parser behaviour is pinned in `src/lib/comps/sources/__fixtures__/ebay-marketplace-insights-item-sales.json`.
