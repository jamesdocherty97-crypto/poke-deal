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
5. **Inventory CRUD UI**: add/edit/list stock (card, grade, cost basis, qty, location, source, status). Bulk intake form.
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
