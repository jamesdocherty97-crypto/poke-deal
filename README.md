# Poke Deal

Command centre for running a Pokémon card dealing business: **value → buy → stock → price → list → sell → book profit → reprice**. UK-relevant, GBP-native, built to be extended for months.

This repo is the **frame** — the architecture and one working vertical slice, built by Claude Opus 4.8 as senior engineer. Breadth is handed to Codex (see `CODEX_BACKLOG.md`). Decisions already made are in `DECISIONS.md`. Full rationale is in the project brief.

For a non-technical walkthrough of the product, daily workflows, future features and outstanding actions, see [`USER_GUIDE.md`](USER_GUIDE.md).

---

## What works right now

The whole spine runs **offline, with no API keys** (fixture mode):

```bash
npm install            # full install (Next, Prisma, etc.)
npm run demo           # search → cleaned GBP comps → suggested price → stock it → profit projection
npm test               # unit tests on cleaning, currency, pricing, comps, inventory, metrics and alerts
```

`npm run demo` output (fixture data) proves the core: a Charizard ex is valued from messy mixed-currency sales (lots dropped, wrong grades excluded, outliers stripped), priced for sale, added to inventory, and its margin projected.

To run the app: `npm run dev` then open `/` — the mobile-first PWA shell covers acquire, stock, listings and P&L.

---

## Architecture (what to understand before touching it)

```
src/lib/domain/types.ts        Pure domain types. Money below the boundary = GBP pence (int).
src/lib/comps/
  CompSource.ts                The keystone contract every price provider implements.
  currency.ts                  The GBP boundary. toGbpPence() — nothing downstream sees EUR/USD.
  cleaning.ts                  THE CORE IP. Pure, tested. grade-match → drop lots → window →
                               GBP → IQR outlier strip → median/range/trend + sample size.
  pricing.ts                   Comp → suggested list price (strategy + cost-basis margin floor).
  compService.ts               Orchestrates sources, reconciles to one headline comp.
  prismaCompResultRepo.ts      Persists headline comps for audit/history.
  sources/
    pokemonPriceTracker.ts     Reference adapter. Fixture mode (no key) or live fetch.
    fixtures.ts                Messy sample sales so everything runs offline.
src/lib/inventory/
  inventoryService.ts          comp → inventory → price spine. Repo INTERFACE.
  prismaInventoryRepo.ts       Prisma-backed InventoryRepo used by app/API persistence.
src/lib/catalog/
  pokemonTcgApi.ts             Pokémon TCG API catalog resolver, maps cards/images.
src/lib/db/prisma.ts           Shared lazy Prisma client.
src/lib/dealer/metrics.ts      Pure P&L, sell-through and stock-age metrics.
src/app/                       Mobile-first PWA shell + /api/comps, /api/inventory, /api/listings,
                               /api/dashboard, mark-sold/acquire, listing lifecycle and alerts.
prisma/schema.prisma           Full domain model: Card, InventoryItem, Listing, Sale, CompResult, …
```

### Non-negotiable patterns
1. **GBP pence everywhere below the adapter boundary.** Convert at ingestion via `toGbpPence`. Never store/compare floats or foreign currency downstream.
2. **No comp is a bare number.** Every `CompResult` carries `sampleSize`, `windowDays`, `outliersRemoved`. UI must show confidence.
3. **`cleaning.ts` stays pure** — no DB, no network, no framework imports. It's the reason the app is trustworthy and fast to test.
4. **Sources degrade, never throw** for "no data". Missing key → fixture mode. Dead API → empty result, not a crash.
5. **Domain is card-agnostic.** Don't bake "Pokémon" into inventory/listing/sale logic — sports cards reuse it.

---

## Accounts & keys you need

The frame runs without any of these (fixture mode). Add them to `.env` (copy from `.env.example`) to go live. **You create the accounts; point me/Codex at the dashboards and I'll wire them in.**

| Service | Why | Cost | Where |
|---|---|---|---|
| **Pokemon Price Tracker** | Primary comps (raw + graded), GBP-capable | Free tier → $9.99/mo | https://www.pokemonpricetracker.com/pricing |
| **Pokémon TCG API** | Catalog, images, baseline price | Free | https://dev.pokemontcg.io |
| **PSA Public API** | Cert lookup / slab verification | Free | https://www.psacard.com/publicapi |
| **PokeTrace** | Secondary comps / US or EU raw cross-check | Free tier → Pro | https://poketrace.com/developers |
| **eBay Developer** | Push your *own* listings via Sell API; restricted MI adds UK sold comps | Free, MI approval-gated | https://developer.ebay.com |
| **Discord webhook** | Price/repricing alerts | Free | Server Settings → Integrations → Webhooks |
| **FX provider** | Daily USD/EUR/JPY → GBP conversion cache | Free tier | exchangeratesapi/freecurrencyapi-style daily rates |
| **Postgres** | Storage | Free local / Neon free tier | docker or https://neon.tech |

**Pokemon Price Tracker live path:** set `POKEMON_PRICE_TRACKER_API_KEY` to use the live v2 adapter. The response shape is pinned in `src/lib/comps/sources/__fixtures__/ppt-cards-ebay.json`; the adapter requests `limit=1` to keep credit usage low and maps provider aggregates into GBP `CompResult`s without caching stale prices as truth.

**PokeTrace cross-check path:** set `POKETRACE_API_KEY` in Vercel before relying on bigger raw-card buys. The adapter defaults to `POKETRACE_MARKETS=US,EU`, but the current free-tier production account should use `POKETRACE_MARKETS=US` because EU/Cardmarket access can be plan-gated. Pro accounts can switch to `EU,US` for Cardmarket-first cross-checks. The source maps Cardmarket/TCGPlayer/eBay tiers into GBP `CompResult`s so noisy RAW buckets can be challenged by a second source.

**eBay Marketplace Insights path:** the code is wired as `EbayMarketplaceInsightsSource`, but eBay must grant restricted Marketplace Insights access before it will return UK sold comps. After approval, set `EBAY_INSIGHTS_ENABLED=true` alongside the existing eBay credentials and refresh token (`EBAY_MARKETPLACE_INSIGHTS_ENABLED=true` still works as the legacy flag). Until then the source stays out of comp aggregation and the manual UK sold link remains the reliable fallback.

**FX path:** set `FX_API_KEY` to fetch daily GBP-based rates into Neon. If the provider is down, the app uses cached rates up to seven days old; if no usable cache exists, comps still work with a visible `static FX` note on converted evidence rows.

---

## Database

```bash
# local Postgres
docker run --name pdos-db -e POSTGRES_PASSWORD=pdos -p 5432:5432 -d postgres
npm run db:migrate     # create schema
npm run db:studio      # browse data
```

Money is stored as **GBP pence (Int)** throughout to avoid float drift.

---

## Status

- [x] Architecture + domain model
- [x] Comp cleaning engine (tested)
- [x] Currency boundary (tested)
- [x] Pricing engine (tested)
- [x] Reference adapter (fixture + live-ready)
- [x] comp → inventory spine
- [x] Vertical-slice API + page
- [x] Prisma-backed inventory repo + `/api/inventory`
- [x] Pokémon TCG API catalog resolver + card caching on inventory intake
- [x] Persist headline comps to `CompResult` on lookup
- [x] Mobile-first PWA app shell
- [x] Mark-sold flow with `Sale` creation and P&L dashboard
- [x] Operating expense ledger with net-profit view and CSV export
- [x] Listing lifecycle controls for DRAFT/ACTIVE/ENDED
- [x] RAW comps prefer provider smartMarketPrice when available
- [x] Optional PokeTrace source for secondary raw/graded cross-checks
- [x] eBay Marketplace Insights adapter wired behind approval gate
- [x] Repricing recommendations + Discord notifier interface
- [ ] Everything in `CODEX_BACKLOG.md`
