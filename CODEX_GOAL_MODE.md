# Codex — Goal Mode

Paste this as your goal-mode prompt (or point Codex at this file). It runs on James's Mac, which has terminal access, the live `.env`, a working Neon database, and Vercel/GitHub available — so Codex can do the things Claude couldn't (deploy, run migrations, drive the terminal).

---

## The goal

Turn Pokémon Dealer OS into a tool James actually uses every day to run his Pokémon card dealing business — on **Mac, iPhone and iPad** — covering the full loop: **value → buy → stock → price → list → sell → book profit → reprice**. Make the highest-leverage improvements you can, autonomously, until it's genuinely useful and pleasant on a phone. Everything is GBP, UK-relevant.

You are the senior engineer continuing a well-architected codebase. Build breadth on top of the existing contracts — don't redesign the foundations.

## Current state (what already works — verified live)

- **Comp engine**: `CompService` → `PokemonPriceTrackerSource` (live, API v2, key in `.env`). Returns GBP `CompResult` per grade from eBay aggregates. Pure cleaning engine in `src/lib/comps/cleaning.ts`. 45 tests pass; `npm run build` passes.
- **Database**: Neon Postgres (cloud, Frankfurt), schema migrated. Prisma. Money stored as **GBP pence (Int)**.
- **APIs**: `GET /api/comps`, `GET/POST /api/inventory`, `POST /api/inventory/acquire`, `GET /api/listings`, `GET /api/dashboard`, `PATCH/DELETE /api/inventory/[id]`, and `POST /api/inventory/[id]/sell`. All verified returning live data and persisting to Neon.
- **UI**: Mobile-first PWA shell with Acquire, Stock, Listings and P&L tabs. Acquire can live-price + stock + draft-list; Stock can mark sold; P&L shows realized profit, margin, sell-through and ageing stock.
- **Auth**: `src/middleware.ts` HTTP Basic gate, active only when `APP_PASSWORD` is set (so it's off locally, on in production).
- **Keys in `.env`** (do NOT print or commit): `POKEMON_TCG_API_KEY`, `POKEMON_PRICE_TRACKER_API_KEY` (Pro), `DATABASE_URL` (Neon).

## Non-negotiable patterns (read `README.md` + `DECISIONS.md` first)

1. **GBP pence everywhere** below the adapter boundary. Convert foreign currency at ingestion via `toGbpPence`.
2. **No comp is a bare number** — always carry `sampleSize`, `windowDays`. Surface confidence in the UI.
3. **`cleaning.ts` stays pure** — no DB/network/framework imports.
4. **Sources degrade, never throw** for "no data".
5. **Domain stays card-agnostic** — Inventory/Listing/Sale reference a generic `Card` so sports cards slot in later.
6. Build **against** `CompSource`, the cleaning module, `InventoryRepo`, `acquireToInventory` — extend, don't rewrite.

## Objectives, in priority order

### 1. Ship it to all your devices (highest priority — this is why it exists)
- Deploy to **Vercel** (it's Vercel-ready). Push the repo to GitHub first if needed (`prisma/migrations/` must be committed; `.env` must NOT be).
- Set Vercel env vars: `DATABASE_URL`, `POKEMON_TCG_API_KEY`, `POKEMON_PRICE_TRACKER_API_KEY`, and a strong **`APP_PASSWORD`** (turns on the gate).
- Make it a **PWA**: `manifest.json`, icons, theme color, `viewport` meta, so "Add to Home Screen" on iPhone/iPad gives an app-like launch. Mobile-first layout.
- Verify on a mobile viewport that the comp lookup + acquire flow work, behind the password.

### 2. A real app shell (mobile-first)
Replace the vertical-slice `src/app/page.tsx` with a proper, navigable UI:
- **Inventory** table/list (stock, grade, cost, status, suggested/list price) with add + edit.
- **Comp lookup + Acquire** as a fast "just bought this" flow (the daily core).
- **Listings** view (DRAFT/ACTIVE/SOLD per channel).
- **P&L dashboard** (below).
Design for one-handed phone use at a card fair.

### 3. Close the dealer loop
- **Mark sold** → create `Sale` (use `realizedProfit`), flip item to SOLD.
- **P&L dashboard**: realized profit, margins, sell-through, ageing stock, best/worst movers.
- Listing lifecycle across channels (eBay automatable later via Sell API; others manual/export).

### 4. Data quality on comps (real issue found in testing)
- The eBay **`ungraded`** bucket is noisy — for some cards the "raw" median is wildly high (mislabelled/graded sales leaking in). For RAW, prefer the provider's `smartMarketPrice` and/or the TCGPlayer `prices.market` baseline, and cross-check; surface low confidence when sources disagree.
- Add **`PokeTraceSource`** as a second `CompSource` and wire `CompService` reconciliation (already supported via `detectDisagreement`).
- Consider exposing `smartMarketPrice` (kept in `CompResult.raw`) as a "smart" pricing strategy.

### 5. Depth (high value, in any order)
- **"Should I grade this?" EV calculator** (raw vs PSA-10 × grade odds − grading/postage), using comps + PSA pop.
- **Repricing + alerts**: `Watch`/`Alert` models; price-drop (sourcing) and reprice (stock) triggers; deliver via **Discord webhook** behind a `Notifier` interface.
- **Daily snapshot job** → `PriceSnapshot` → inventory-value-over-time charts.
- **Set gap-finder**; **books CSV export**.
- **PSA cert lookup** adapter (free API; key optional).

### 6. Performance & polish
- First `acquire` is slow (~20–30s): cold compile + live catalog resolve + DB writes. Cache catalog lookups aggressively, parallelise independent awaits, add fetch timeouts, and consider doing comp-persist/listing-create off the request path.
- Rate-limit/credit-budget guard around Pokemon Price Tracker (billed on requested `limit`; we already pass `limit=1`).

## Known cleanup from the setup session
- **Done:** the 2 setup-session inventory rows (Charizard ex PSA_10, £900 cost) were deleted from Neon. Inventory/listings were checked clean after smoke tests.
- Commit the `prisma/migrations/` folder (created by `migrate dev`).
- Current workspace note: this folder is not a Git checkout, and `gh`/`vercel` CLIs are not installed here. Deployment needs a GitHub repo/remote or authenticated deployment tooling.
- James should manually **revoke the orphaned Pokemon Price Tracker key** named `pokemon-dealer-os` in their dashboard (a second key `pdos-live` is the one in `.env`).

## Verification protocol (do this before calling anything done)
- `npm test` (keep the suite green; add tests for new logic — match the `*.test.ts` style, especially pure functions).
- `npx tsc -p tsconfig.check.json` and `npm run build` must both pass.
- Smoke the endpoints against the running dev server.
- For each new `CompSource` or parser, pin behaviour with a captured-response fixture test (see `src/lib/comps/sources/__fixtures__/`).

## Definition of done for goal mode
A deployed, password-protected, mobile-usable PWA where James can, from his phone: look up a card's GBP comp, stock it at a suggested price, see his inventory and realized P&L, mark items sold, and receive a price-drop/repricing alert — with comps he can trust (confidence surfaced, raw-price noise handled). Everything in GBP, tests green, build passing.

## Don't
- Don't commit or print secrets. Don't weaken the auth gate.
- Don't break fixture mode (the app must still run with no API keys).
- Don't redesign the core contracts to avoid a small amount of work — flag it instead.
- Don't introduce a second source of truth for money (GBP pence only).
