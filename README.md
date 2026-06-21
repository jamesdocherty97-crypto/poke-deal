# Pokémon Dealer OS

Command centre for running a Pokémon card dealing business: **value → buy → stock → price → list → sell → book profit**. UK-relevant, GBP-native, built to be extended for months.

This repo is the **frame** — the architecture and one working vertical slice, built by Claude Opus 4.8 as senior engineer. Breadth is handed to Codex (see `CODEX_BACKLOG.md`). Decisions already made are in `DECISIONS.md`. Full rationale is in the project brief.

---

## What works right now

The whole spine runs **offline, with no API keys** (fixture mode):

```bash
npm install            # full install (Next, Prisma, etc.)
npm run demo           # search → cleaned GBP comps → suggested price → stock it → profit projection
npm test               # 22 unit tests on the cleaning, currency & pricing engines
```

`npm run demo` output (fixture data) proves the core: a Charizard ex is valued from messy mixed-currency sales (lots dropped, wrong grades excluded, outliers stripped), priced for sale, added to inventory, and its margin projected.

To run the UI slice: `npm run dev` then open `/` — a comp-lookup page hitting `GET /api/comps`.

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
                               /api/dashboard and mark-sold/acquire actions.
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
| **PokeTrace** (optional) | Secondary comps / cross-check | Free tier → Pro | https://poketrace.com/developers |
| **eBay Developer** (Phase 3) | Push your *own* listings via Sell API | Free | https://developer.ebay.com |
| **Discord webhook** | Price/repricing alerts | Free | Server Settings → Integrations → Webhooks |
| **Postgres** | Storage | Free local / Neon free tier | docker or https://neon.tech |

**First thing to do when you have a Pokemon Price Tracker key:** set `POKEMON_PRICE_TRACKER_API_KEY`, then confirm the live response shape against their docs and tighten `mapResponseToRawSales()` in `sources/pokemonPriceTracker.ts` (it's written defensively and marked TODO). Everything else already cleans identically.

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
- [x] RAW comps prefer provider smartMarketPrice when available
- [ ] Everything in `CODEX_BACKLOG.md`
