# Codex Backlog

Ordered build plan for Pokémon Dealer OS. The **frame is done**: domain model, the `CompSource` contract, the comp-cleaning engine, currency boundary, pricing engine, one reference adapter, the comp→inventory spine, and a vertical-slice UI — all type-clean with 22 passing tests.

## Handover rule (read first)
- Build **against** the existing contracts (`CompSource`, `cleaning.ts`, `pricing.ts`, `InventoryRepo`). Do **not** redesign them. If you think they need changing, stop and flag it — that's a planning decision, not a mid-grind one.
- Respect the five non-negotiable patterns in `README.md` (GBP pence everywhere; comps always carry sample size; `cleaning.ts` stays pure; sources degrade not throw; domain stays card-agnostic).
- Every new module gets unit tests in the same style as `*.test.ts`. Run `npm test` and `npx tsc -p tsconfig.check.json` before considering anything done.

---

## Phase 1 — persistence & catalog (unblocks everything)
1. [x] **PrismaInventoryRepo** implementing `InventoryRepo` against `prisma/schema.prisma`. Swapped into app persistence via `GET/POST /api/inventory`.
2. [x] **Catalog adapter** for the Pokémon TCG API: resolve a `CardRef` (name/set/number) to a real `Card` row with image + `tcgApiId`. Cache to DB.
3. [x] **Persist comps**: write each headline `CompResult` to the `CompResult` table on lookup (audit + history).
4. [ ] Wire the real `POKEMON_PRICE_TRACKER_API_KEY` path: confirm live response shape, tighten `mapResponseToRawSales()`, add a captured-response fixture test.

## Phase 2 — close the dealer loop
5. **Inventory CRUD UI**: add/edit/list stock (card, grade, cost basis, qty, location, source, status). Add/list/edit are now in the app; bulk intake form remains.
6. **Listing support**: generate title/description + suggested price (from `pricing.ts`); create `Listing` rows per channel; track state; "mark sold" → writes a `Sale` and flips item to SOLD.
7. **Profit & margin dashboard**: realized P&L (use `realizedProfit`), margins, sell-through, ageing inventory, best/worst movers.
8. **Second comp source**: `PokeTraceSource implements CompSource`, added to `CompService.default()`. Cross-source reconciliation already supported — verify `detectDisagreement` surfaces in UI.
9. **PSA cert lookup**: adapter for the PSA Public API; attach cert/pop context to graded items.

## Phase 3 — automation & depth
10. **Daily snapshot job**: background worker writes `PriceSnapshot` for owned cards → powers inventory-value-over-time.
11. **Repricing + alerts**: `Watch`/`Alert` models; detect price drops (sourcing) and reprice triggers (stock); deliver via Discord webhook behind a `Notifier` interface.
12. **eBay Sell API**: push/draft real listings from inventory (your own listings — free Sell API, not the gated insights one).
13. **Set gap-finder**: given a target set, compute cheapest path to complete from current comps.
14. **Books export**: CSV of sales + costs + fees for the accountant.
15. **Scan-a-card** (stretch): photo → identify → value → fast intake.

## Cross-cutting
- Rate-limit / credit-budget guard around live sources; cache aggressively.
- Error/empty/low-confidence states everywhere comps are shown.
- Replace the static FX rates (`currency.ts`) with a live daily-cached provider when `FX_API_KEY` is set.

## Future (not now — see brief §9)
- Sports/soccer via a `SportsCardsProSource` adapter + `Game.SOCCER`. Inventory/listing/sales already card-agnostic. Known gap: UK-native soccer sold comps (eBay.co.uk) need a custom feed.

## Phase 4 — UX & visual polish (audit follow-up, 2026-06-21)

Grounded in the current `src/app/page.tsx` / `globals.css`. The app already has a strong visual identity (dark Pokédex theme, hero card art, status pills, deal-judge logic) — these are about making it feel finished and faster to use day to day, not a redesign.

**Quick wins (small diff, high payoff):**
1. [x] Loading state for first paint: `dashboard`/`inventory` start `null`/`[]`, so the status strip shows "Stock 0 / Profit £0.00" for a beat before the real numbers land. Render a skeleton/dimmed state for `.status-strip` and `.metric` until the corresponding fetch resolves, instead of a false zero.
2. [x] `<img>` fallback for card art: `card.imageUrl` / `catalogCard.imageUrl` point at the Pokémon TCG API's CDN, which does occasionally 404. Add `onError` handlers on every card-art `<img>` (hero, comp panel, catalog strip, inventory/listing thumbs) that swap to the existing `.card-thumb.blank` / `.catalog-art.blank` placeholder treatment instead of showing a broken-image icon.
3. [x] £ adornment on every GBP `<input>` (cost, sale price, fees, postage, grading cost) — currently plain text inputs with the currency only named in the label. A simple inline `£` prefix (wrapping div + absolutely positioned span) would read as more native and finish the "looking great" bar.
4. [x] Promote the deal-judge verdict (Catch / Watch / Pass in `judgeDeal()`): it's the single most decision-critical signal in the app but currently rendered as a small 3-column grid at the bottom of the comp panel. Move it to a full-width colored banner directly under the price hero (`.comp-hero`), with the tone color driving the banner background the way `.deal-card.good/.warn/.danger` already does for text.
5. [x] `EmptyState` treatment for the Loot/P&L metric grid on a fresh install — right now a brand-new dealer just sees an honest but bare wall of `£0.00`. Layer the same "nothing booked yet" framing already used for Inventory/Listings over the metric grid, not just the Recent Sales list below it.

**Worth the extra lift:**
6. [x] Search/filter/sort on Inventory and Listings (`view === "inventory" | "listings"`). Filter by name/set/grade, sort by age/value, and filter listings by state — fits the "Dex" branding directly and is the first thing that'll matter once stock grows past a screenful.
7. [x] Grade badges: render `PSA_10` / `BGS_9_5` etc. as a small colored "slab" badge (reusing the `.pill` pattern) instead of plain text in `InventoryRow`/`ListingRow` — graded cards are the highest-value items in the dex and deserve to read faster than the rest.
8. Swipe-to-sell / swipe-to-delete on inventory rows on mobile, replacing/augmenting the current button row — the layout is already mobile-first (bottom sheet, bottom nav), this is a natural extension.
9. [x] Replace the native `window.confirm()` on delete with an in-app confirm sheet styled like `.sell-sheet` / the listing editor — a native browser dialog breaks the immersion of an otherwise fully custom UI.
10. [x] A small profit sparkline in the Loot tab. `dashboard.recentSales` already carries `profitPence` + `soldAt` — a lightweight inline SVG sparkline needs no new dependency and turns a list of numbers into something that reads as a trend at a glance.

**Nice to have:**
11. [x] Make "quick hunts" (currently 4 hardcoded chase cards in `page.tsx`) user-editable — pin your own most-searched cards instead of a static Charizard/Pikachu/Mew/Umbreon list that may not reflect what this dealer actually deals in.
12. Pull-to-refresh on mobile alongside the existing manual refresh icon button.
13. Auto-dismissing toast-style notices instead of the persistent top-of-page `.notice` banner, which otherwise lingers until the next action clears it.
14. Arrow-key navigation through the set-autocomplete dropdown (`.set-suggestions`) for desktop/keyboard users — currently mouse/touch only.

## Note on `tsconfig.check.json` (audit follow-up, 2026-06-21)
Widening `tsconfig.check.json`'s `include` to cover `src/app` (it currently excludes the entire app layer from type-checking) is still worth doing, but needs a machine with a real, fully-generated Prisma client to do safely — attempting it in a network-restricted sandbox surfaced errors that are indistinguishable from real bugs without one. Specifically, once `src/app` is included, four spots stop type-checking cleanly against a stub/incomplete client: the `tx` transaction callback in `src/app/api/inventory/[id]/route.ts` (`DELETE`), `src/app/api/inventory/[id]/sell/route.ts` (`POST`), and `src/app/api/listings/[id]/route.ts` (`PATCH`) all come back as implicit-`any` (should resolve to `Prisma.TransactionClient` automatically on a healthy client — explicit annotation is a safe, standard fix either way), and `listings/[id]/route.ts` also references `Prisma.ListingUpdateInput`, a schema-specific generated type that only exists after a full `prisma generate`. Do this with `npx prisma generate` succeeding first, fix whatever genuinely remains, then flip the `exclude` in `tsconfig.check.json`.
