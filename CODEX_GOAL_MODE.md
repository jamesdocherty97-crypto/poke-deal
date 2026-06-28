# Codex — Goal Mode (refreshed 2026-06-21)

Paste this as your goal-mode prompt (or point Codex at this file). It runs on James's Mac, which has terminal access, the live `.env`, a working Neon database, and Vercel/GitHub available — so Codex can do the things Claude couldn't (deploy, run migrations, drive the terminal, regenerate the real Prisma client).

This is a refresh of an earlier goal-mode handover after a Claude pass focused on search quality and UX. Read this version, not your memory of an older one — several things below changed.

---

## The goal

Turn Poke Deal into a tool James actually uses every day to run his Pokémon card dealing business — on **Mac, iPhone and iPad** — covering the full loop: **value → buy → stock → price → list → sell → book profit → reprice**. Make the highest-leverage improvements you can, autonomously, until it's genuinely useful and pleasant on a phone. Everything is GBP, UK-relevant.

You are the senior engineer continuing a well-architected codebase. Build breadth on top of the existing contracts — don't redesign the foundations. Where this doc gives concrete suggestions, treat them as a starting point, not a spec — see "Creative freedom" below.

## Current state (verified this session, not assumed)

- **Comp engine**: `CompService` → `PokemonPriceTrackerSource` (live, API v2, key in `.env`). Returns GBP `CompResult` per grade. Pure cleaning engine in `src/lib/comps/cleaning.ts`. `PokeTraceSource` is **still just a comment** in `compService.ts` ("Add PokeTrace etc. here") — not built.
- **Tests**: 57 passing (`npm test`), up from 45 — this session added catalog/set-resolution coverage. Keep this green and growing.
- **Database**: Neon Postgres, Prisma. Money stored as **GBP pence (Int)**. Schema (`prisma/schema.prisma`) already has `Watch` and `Alert` models defined — but nothing in `src/lib` reads or writes them yet. The repricing feature (`src/lib/alerts/repricing.ts`) computes recommendations live and posts to Discord; it does **not** persist a `Watch`/`Alert` row. That's a real, open gap, not a misunderstanding.
- **Catalog/search (this session's work)**: `src/lib/catalog/setCatalog.ts` bundles all 173 official sets offline with alias/nickname resolution (`resolveSetId`, `searchSets`, `getPopularSets`); `pokemonTcgApi.ts` does progressive query relaxation (name+number+set → name+set → name+number → name) and collector-number leading-zero normalization. `/api/catalog/sets` and `/api/catalog/search` back a set-autocomplete + popular-set chips in the Acquire tab. `PrismaCardCache` (`src/lib/catalog/prismaCardCache.ts`) already caches individual *cards* by `tcgApiId` — but only lazily, one at a time, on `acquire`. There is **no bulk pre-warming of cards** yet and **no card-name autocomplete** (only sets) — see priorities below.
- **PWA**: `src/app/manifest.ts` + `public/icon.svg` + viewport metadata are already in place — this is mostly done, contrary to what an older version of this doc implied.
- **Deployment**: a `.vercel/project.json` exists and there's a "Fix Prisma generation on Vercel" commit in history — this has likely already been deployed at least once. Verify it's still live and current rather than redoing it from scratch.
- **APIs**: `GET /api/comps`, `GET/POST /api/inventory`, `POST /api/inventory/acquire`, `GET /api/listings`, `PATCH /api/listings/[id]`, `GET /api/dashboard`, `PATCH/DELETE /api/inventory/[id]`, `POST /api/inventory/[id]/sell`, `POST /api/alerts/reprice`, `GET /api/catalog/sets`, `GET /api/catalog/search`.
- **UI**: single mobile-first shell (`src/app/page.tsx`) — Acquire (Catch), Inventory (Dex), Listings (Market), P&L (Loot) tabs, bottom nav, dark Pokédex-style theme. Functionally complete for the core loop; visual/interaction polish list below.
- **Auth**: `src/middleware.ts` HTTP Basic gate, active only when `APP_PASSWORD` is set.
- **Keys in `.env`** (do NOT print or commit): `POKEMON_TCG_API_KEY`, `POKEMON_PRICE_TRACKER_API_KEY`, `DATABASE_URL` (Neon), `POKETRACE_API_KEY`/`PSA_API_TOKEN`/`DISCORD_WEBHOOK_URL` (present in `.env.example`, check which are actually filled in).

## What Claude did this pass (full detail in `AUDIT_2026-06-21.md`)

Fixed the reported search bug (Charizard / `04/102` / "base set" returning nothing): collector-number leading-zero normalization, a real offline set catalog replacing fragile `set.name` phrase queries, progressive query fallback, and a scoring fix. Added the set-autocomplete/popular-sets UI. Fixed an implicit-`any` in `src/app/api/dashboard/route.ts`. Investigated widening `tsconfig.check.json` to cover `src/app` (currently excluded — see "Known sharp edge" below) but couldn't safely finish it without a working `prisma generate`. Added a "Phase 4 — UX & visual polish" section to `CODEX_BACKLOG.md` with 14 grounded, specific UI items. None of this is duplicated below except where it sets up the next priorities.

## Non-negotiable patterns (read `README.md` + `DECISIONS.md` first)

1. **GBP pence everywhere** below the adapter boundary. Convert foreign currency at ingestion via `toGbpPence`.
2. **No comp is a bare number** — always carry `sampleSize`, `windowDays`. Surface confidence in the UI.
3. **`cleaning.ts` stays pure** — no DB/network/framework imports.
4. **Sources degrade, never throw** for "no data".
5. **Domain stays card-agnostic** — Inventory/Listing/Sale reference a generic `Card` so sports cards slot in later.
6. Build **against** `CompSource`, `CatalogSource`, the cleaning module, `InventoryRepo`, `acquireToInventory` — extend, don't rewrite. If a contract genuinely needs to change, stop and flag it rather than quietly working around it.

## Directed priorities (James asked for these explicitly)

This round, James was explicit: **comps are the centerpiece.** They need to be smooth, fast to use, flexible to search against, and as accurate as the underlying data allows. Pre-population and fuzzy search (priorities 2–3) exist in service of that — better search input produces better comps. All three are outcomes, not exact implementations — use judgment on the how.

### 1. Comps: the centerpiece — smooth, accurate, flexible
Make the comp panel the most trustworthy part of the app. Two halves: close feedback loops that already have data sitting unused, and actually use more of what the two paid APIs already give you for free — verified this session, not guessed.

**Feedback loops (data you already have, not yet wired up):**
- **Two-stage resolve-then-comp**: once a card is confidently matched to a catalog entry (exact `tcgApiId`), re-issue the comp lookup using the catalog's *canonical* name/number/set rather than the user's raw typed input. Tighter queries to the comp source should mean fewer "no comps" and less noise.
- **Feed real sales back in**: confirmed `Sale` rows already exist in the DB (real, GBP, dated) and currently aren't reused anywhere. Nothing is a more realistic comp than what this dealer actually sold the exact card for. Surface recent owned sales of the same card/grade alongside (or blended into) the live comp.
- **Show the receipts**: an expandable "what this number is based on" on the comp panel — sample dates/count, what got stripped as an outlier and why. Builds trust in the number the dealer is about to act on.
- **Staleness signal**: comps persist with `asOf`; show "priced 6 days ago" and a one-tap refresh, so a fast-moving chase card doesn't get bought against a stale number.
- **Make disagreement actionable**: `detectDisagreement`/`sourcesDisagree` already exist in `compService.ts` — today they just produce a "treat this as a check-before-buy price" label. Consider a one-tap link to a live eBay sold-listings search for the exact query when sources disagree.

**API features genuinely worth turning on (confirmed against the official docs and this repo's own code/fixtures, not assumed):**
- **The catalog source is throwing away free pricing data on every single lookup.** `src/lib/catalog/pokemonTcgApi.ts` line 6 sets `SELECT_FIELDS = "id,name,number,rarity,images,set"`. Every card the Pokémon TCG API returns also carries a `tcgplayer` hash (USD; variants normal/holofoil/reverseHolofoil/1stEditionHolofoil/1stEditionNormal, each with low/mid/high/market/directLow) and a `cardmarket` hash (EUR: averageSellPrice/lowPrice/trendPrice/avg1/avg7/avg30/etc.) — confirmed against docs.pokemontcg.io's card-object reference. That's a second, free, zero-extra-request price signal riding along on every catalog resolve you're already making. Add `tcgplayer,cardmarket` to `SELECT_FIELDS`, convert via the existing `toGbpPence`/`currency.ts`, and use it as a sanity-check baseline or even a real `CompSource` — when `PokemonPriceTrackerSource` has a thin eBay sample, a TCGPlayer/Cardmarket market price is a far better fallback than an empty comp.
- **The Price Tracker payload already contains a blended price you're not reading.** `mapCardAggregateToComp()` in `src/lib/comps/sources/pokemonPriceTracker.ts` only ever reads `data.ebay.salesByGrade` — but the live response (see the captured fixture `src/lib/comps/sources/__fixtures__/ppt-cards-ebay.json`, which has a top-level `"prices": { "market": ..., "low": ... }` right next to the `ebay` block) carries a price that's currently parsed into nothing. Confirm what it represents (it reads like a cross-marketplace blended figure, not eBay-only) and use it — at minimum as a second number for the disagreement check above.
- **`trendPct` is hardcoded `null` with the fix already noted in a comment.** Same file: "a real % can be derived from ebay.priceHistory later." Their docs reference an `includeHistory=true&days=N` param on `/api/v2/cards`. Pull real history and turn the trend indicator from a vague "up"/"down" string into an actual percentage.
- **Check your actual Price Tracker plan tier.** Their published tiers differ meaningfully on history depth (3 days Free / 6 months on the $9.99 API tier / 12+ months on $99 Business) and the $99 tier adds **population reports (PSA/CGC/BGS pop counts)** — pop data would make grading-aware comps materially more accurate (a card with 40,000 PSA 10s in existence prices very differently from one with 12) and feeds directly into the still-open "PSA cert lookup" backlog item. Worth checking what your account actually has access to before assuming it's out of reach.
- **One honest caveat**: their interactive docs (pokemonpricetracker.com/docs) are a client-rendered app that wouldn't load for me in this sandbox, so I couldn't directly verify exact history/bulk endpoint parameter names — confirm those against the real docs or your account dashboard before building against them. Everything stated as fact above (the `tcgplayer`/`cardmarket` fields, the unread `data.prices`, the hardcoded `trendPct: null`) I checked directly against the official docs or this repo's own source/fixtures.

### 2. Pre-populate catalog data more aggressively
The set-level catalog (173 sets, offline, aliased) is done. The card level isn't:
- `PrismaCardCache` already upserts individual cards by `tcgApiId`, but only reactively, one at a time, at `acquire` time. Turn this into a real warm cache: walk the Pokémon TCG API per popular set (`getPopularSets()` in `setCatalog.ts` already gives you the list) and bulk-upsert every card in those sets into the `Card` table ahead of time — a one-off script or an admin-gated route, your call. The point is that the cards a dealer actually searches for are already in the DB before they ever search, not fetched cold on first use. Pull the pricing fields (above) into the same upsert while you're there — pre-populating the catalog and pre-populating a price baseline is the same walk.
- Build card-name autocomplete the same way the set-autocomplete was just built (`/api/catalog/search` for sets is the template) — query the local `Card` cache first (instant, offline-capable for anything already warmed), fall back to a live, debounced Pokémon TCG API call for anything not yet seen, and cache what comes back. Every real search becomes a cache-fill, so coverage grows on its own even without the bulk warm job running.
- Optional but high-leverage: bundle a small static "chase list" snapshot (100–200 well-known modern + vintage chase cards) the same way `setCatalog.ts` bundles sets, so the very first cold lookup for the cards people actually search for resolves instantly, online or offline.

### 3. Fuzzy, typo-tolerant search
The set resolver does token-subset matching today (all query tokens must appear, fewer extra tokens scores higher) but it isn't typo-tolerant — "Charzard" won't currently match "Charizard". Add a lightweight edit-distance scorer (Levenshtein/Damerau — no new dependency needed, it's ~25 lines) and blend it into both `resolveSetId`/`searchSets` and whatever card-name search you build per priority 2. Also worth normalizing punctuation/diacritic variance that trips up exact matches today: "Mr. Mime" vs "Mr Mime", accented characters in some card names, "♀/♂" vs "F/M". When a lookup comes back empty or very low-confidence, surface 2–3 nearest fuzzy matches ("did you mean…") instead of a flat empty state — don't dead-end a typo.

## Creative freedom

The three priorities above are the ask, not the ceiling. James's instruction was explicitly "use your creativity, but also allow codex creative freedom to just make it better" — so beyond the directed work, use your own judgment about what would make this genuinely better to use every day. A few seed ideas, purely illustrative, not a checklist: a "what's hot" surface built from the `CompResult` history that's already being persisted (price deltas over the snapshot window); a set-completion view leaning on the 173-set catalog plus owned inventory (fits the Pokédex branding already established); anything in the "Phase 4 — UX & visual polish" section of `CODEX_BACKLOG.md` if it's faster to ship alongside this work than separately. The only real constraints are the six non-negotiables above — everything else is genuinely your call.

## Also open (lower priority than the above, tracked from before)

- **`PokeTraceSource`**: second `CompSource`, wired into `CompService.default()`. Reconciliation (`detectDisagreement`) already supports a second source; it just has nothing to disagree with yet.
- **Persisted `Watch`/`Alert`**: the schema models exist and are unused. Repricing currently computes-and-Discord-posts without writing history; a watchlist (price drop on sourcing targets, not just repricing on owned stock) is schema-ready but has zero application code.
- **PSA cert lookup**, **daily `PriceSnapshot` job** (model exists, no writer), **set gap-finder**, **books CSV export**, **eBay Sell API push** — all still open, see `CODEX_BACKLOG.md` Phases 2–3 for detail.
- **`POKEMON_PRICE_TRACKER_API_KEY` live response shape**: still flagged as unconfirmed against a captured fixture in `CODEX_BACKLOG.md` Phase 1 #4.

## Known sharp edge: `tsconfig.check.json` excludes `src/app`

The documented verification command (`npx tsc -p tsconfig.check.json`) has never actually type-checked anything under `src/app` — it's explicitly excluded. Claude found this, tried widening it, and found four spots that need `npx prisma generate` to have actually completed first to verify correctly (three untyped `tx` transaction-client callbacks, one `Prisma.ListingUpdateInput` reference) — see the bottom of `CODEX_BACKLOG.md` for the exact files/lines. You have a working Prisma client here; Claude's sandbox didn't. Worth actually finishing this: run `prisma generate` for real, widen the `include`, fix whatever genuinely remains, flip the `exclude`.

## Verification protocol (do this before calling anything done)

- `npm test` (57 passing as of this handover; keep it green, add tests for new logic in the existing `*.test.ts` style — especially pure functions).
- `npx tsc -p tsconfig.check.json` and `npm run build` must both pass. (Claude could not get `npm run build` to complete in its own sandbox due to a network restriction on Prisma's engine binaries — unrelated to any code change, but it means **you** are the first one actually running this build end to end on this code. Don't assume it's clean; verify it.)
- Smoke the endpoints against the running dev server.
- For each new `CompSource`/`CatalogSource` or parser, pin behaviour with a captured-response fixture test (see `src/lib/comps/sources/__fixtures__/` for the existing pattern).

## Ship it when you're done

This is real software James runs his business on, not a sandbox exercise. Once the verification protocol above is green: commit, push to `origin` (`github.com/jamesdocherty97-crypto/poke-deal`, already connected to the Vercel project `poke-deal` — see `.vercel/project.json`), and confirm the deploy actually went live — check the Vercel dashboard/`vercel ls` or hit the production URL directly, don't just trust that `npm run dev` looked right locally. If you changed `prisma/schema.prisma`, apply the migration to the real production database with `npx prisma migrate deploy` (not `migrate dev`, which is for local iteration) as part of the deploy, and if you add any new env var (e.g. wiring up `PokeTraceSource`, a new API key), set it in the Vercel project's environment settings, not just your local `.env`. Don't call this handover finished until James can open the live app on his phone and see the changes.

## Don't

- Don't commit or print secrets. Don't weaken the auth gate.
- Don't break fixture mode (the app must still run with no API keys).
- Don't redesign the core contracts to avoid a small amount of work — flag it instead.
- Don't introduce a second source of truth for money (GBP pence only).
- Don't treat any specific implementation suggested above as mandatory — the directed priorities are outcomes James wants; how you get there is yours to decide.
