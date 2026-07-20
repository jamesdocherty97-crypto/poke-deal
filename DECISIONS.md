# Resolved Decisions

The six open decisions from the brief (§11), settled so the build can proceed without re-litigating them. Change here if you disagree — but treat this as the source of truth Codex builds against.

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Hosting | **Local-first dev; deploy-ready for Vercel + Neon later** | No always-on cost while building. Nothing in the architecture blocks deployment; the worker just needs a host when alerts go live. |
| 2 | Alert channel | **Discord webhook + in-app** | Zero approval friction, free, trivial to POST to. Email/Telegram can be added behind the same `Notifier` interface later. |
| 3 | Channels at launch | **Model all four (eBay, Cardmarket, Vinted, In-person). Automate eBay only.** | eBay Sell API is open for your own listings; the others have no open listing API, so they're tracked + export/draft. Modelling all four now avoids a schema migration later. |
| 4 | Card scope | **English-only in v1; Japanese later** | Keeps catalog matching and comp parsing simpler. The `Card` model carries a `language` field so JP is additive, not a rewrite. |
| 5 | History backfill | **Accumulate forward + daily snapshots. No paid backfill day one.** | Keeps API credit burn near zero. Trend/portfolio history builds itself from the daily snapshot job. |
| 6 | Books export | **Plain CSV v1** | Imports into anything (Xero, QuickBooks, a spreadsheet, an accountant's inbox). A targeted integration can come later if needed. |

## Engineering stances taken in the frame

- **GBP is the only currency below the adapter boundary.** Every source converts at ingestion via `toGBP()`. No EUR/USD leaks downstream.
- **No comp is ever a bare number.** A `CompResult` always carries `sampleSize`, `windowDays`, and outlier count. The UI must surface confidence.
- **The cleaning engine is pure and dependency-free.** No DB, no network, no framework imports — so it's fast to test and impossible to break by accident. This is the app's core IP.
- **Sources are swappable and degrade gracefully.** Missing API key → the adapter runs in fixture mode rather than throwing, so the whole spine is demoable offline.
- **The domain is card-agnostic.** Inventory/Listing/Sale reference a generic `Card`, so sports cards (§9) slot in without touching the dealer loop.

## Comp source stance

- **Current suite is enough for launch once PokeTrace is enabled in production.** Price Tracker is the primary sold-comp source, Pokémon TCG API resolves card identity/images and raw market baselines, PokeTrace is the required second opinion for bigger raw buys, and owned sales become a private source after James books sales.
- **UK relevance means EU/Cardmarket signals matter.** PokeTrace is queried EU-first, then US fallback, so raw cross-checks can use Cardmarket-style baselines before leaning on US TCGPlayer/eBay signals.
- **Do not trust noisy RAW sold buckets alone.** When smart RAW, catalog/PokeTrace baselines, and owned sales disagree materially, the UI should say to manually check rather than pretending a single median is safe.

## Data safety / backups

- **The app has a portable ledger backup.** `npm run backup` exports every persisted business table to `output/backups/<timestamp>/` as one JSON bundle plus per-table CSVs. `npm run restore -- <bundle>` restores a bundle into an empty database and verifies row counts; it refuses a non-empty database unless `--force` is supplied.
- **Neon point-in-time recovery depends on the project restore window, not this repo.** Neon documents instant restore/history windows by plan: Free defaults to a short history window, paid plans can configure longer windows, and the effective restore window is managed in the Neon project settings. See `https://neon.com/docs/introduction/history-window`, `https://neon.com/docs/introduction/plans`, and `https://neon.com/docs/manage/projects`.
- **Until the Neon restore window is confirmed in the Neon console, the product must say “backups: manual only.”** The Setup health panel treats the app-level export as available but does not promise PITR coverage that the code cannot verify.
- **Use manual backup before risky operations.** Take a JSON bundle before schema work, bulk imports, catalogue migrations, listing automation changes, or any production data cleanup.

## 2026-07-11 — Architecture overhaul decisions

### A1. Reuse one Prisma client per server runtime and add only query-backed indexes

- **Decision:** Cache the `PrismaClient` on `globalThis` in every environment, including production. Runtime `DATABASE_URL` uses Neon's pooled endpoint while Prisma's `directUrl`/`DIRECT_URL` uses the matching direct endpoint for migrations. Add non-destructive B-tree indexes only for demonstrated hot query shapes: inventory status/recent update, listing item/state, comp latest-created lookup, cron status/recent start, and scan correction/recent telemetry.
- **Why:** A warm serverless isolate must not create a fresh connection pool for every request. The indexes match current `where` + `orderBy` clauses and do not change data or uniqueness semantics. A pooled Neon `DATABASE_URL` is still an operational requirement; application reuse complements rather than replaces provider pooling.
- **Migration:** Add indexes concurrently where the migration runner supports it; this repository's Prisma migration uses ordinary `CREATE INDEX IF NOT EXISTS` so it remains portable and replay-safe. New telemetry/review columns are nullable or have safe defaults.
- **Rollback:** Revert the client cache change and `DROP INDEX IF EXISTS` each added index. No row rewrite or destructive rollback is required.
- **Guards:** Prisma lifecycle unit test, `prisma validate`, migration SQL review, repository/API contract tests, full TypeScript/test gates.

### A2. Progressive comp delivery is versioned NDJSON; the legacy JSON route remains authoritative

- **Decision:** Keep `GET /api/comps` response-compatible and add `GET /api/comps/stream` using `application/x-ndjson`. Version-1 events are ordered `catalog` -> zero or more `source`/`verdict` updates -> exactly one terminal `receipt` or `error`. Every price-bearing event carries the full `CompResult` and reconciliation receipt (sample size, window/freshness, source mix and confidence); the contract never emits a naked pence value.
- **Why:** NDJSON works with ordinary `fetch()` streaming, is easy to record/replay, and does not force EventSource's GET-only reconnection semantics onto a lookup. A versioned discriminated union provides an upgrade seam. Bare-query ambiguity discovery and source fan-out run concurrently; provisional verdicts remain conservatively manual-check while ambiguity is pending.
- **Migration:** Additive route and types only. Consumers can opt in; existing consumers continue using `/api/comps` unchanged.
- **Rollback:** Remove the stream route and event adapter; no stored data changes and legacy lookup remains available.
- **Guards:** Event-order/terminal-event contract tests, progressive source/quorum tests, legacy comp tests, red-team pricing suite.

### A3. Manual checks remain part of the append-only comp audit

- **Decision:** Extend headline `CompResult` audit rows with `confidence`, `manualCheck`, `reasons`, `receipt`, `resolvedAt`, `resolution`, and `resolutionNote`, rather than introducing a separate mutable review table. Expose a list/resolve API over those rows. Resolution metadata is mutable; the valuation evidence and original receipt remain append-only.
- **Why:** One valuation request should have one durable audit artifact. A second review entity would duplicate card/grade/headline identity and create synchronization failure modes. Nullable/defaulted columns preserve all existing rows.
- **Migration:** Existing rows default to `manualCheck=false`; new headline persistence records the reconciler output and source receipt. The worklist index is `(manualCheck, resolvedAt, createdAt)`.
- **Rollback:** Drop the added index and columns. Existing core comp columns and history are untouched. Export/backup remains forward-compatible because Prisma enumerates the table dynamically at runtime.
- **Guards:** Repository persistence tests plus list/resolve endpoint service tests; resolution rejects unknown outcomes and cannot mutate evidence fields.

### A4. Scan limits and corrections are durable when the database is available

- **Decision:** Enforce request `Content-Length` and decoded-image bounds before the Gemini call, add an explicit abort budget, and reserve daily/session scan budget through persisted `ScanEvent` rows when Postgres is configured. A bounded in-process guard remains the best-available fallback for local/DB-outage operation. Extend `ScanEvent` with request bytes, input kind, latency, session hash, correction linkage and corrected identity fields; expose an append-only correction endpoint.
- **Why:** Per-instance counters reset on cold starts and cannot enforce a daily cost ceiling. Session hashing limits one client dominating the shared budget without storing an identifying token. The hash input is a stable device-session header, with bounded IP/UA fallback; per-request mutation ids are forbidden as session identity because they would reset fairness on every attempt. Corrections must preserve the original observation for evaluation rather than overwrite it.
- **Migration:** New fields are nullable and existing scan rows remain valid. Corrections insert a new event linked to the original; they never rewrite model output.
- **Rollback:** Stop using the durable reservation/correction APIs and drop the nullable columns/indexes. Original scan observations remain intact.
- **Guards:** Body-limit, timeout/abort, daily/session budget and correction validation/idempotency tests.

### A5. Offline buy/sell retries use domain-row idempotency keys

- **Decision:** Persist the client-provided `X-Poke-Deal-Mutation-Id` on the created `InventoryItem`, and on each `Sale` as the composite `(clientMutationId, mutationIndex)`. The acquire and sell routes replay the already-created domain result when the same key is seen. Keys are capped and validated; a key is scoped to the mutation route by its storage location.
- **Why:** An in-memory response cache fails across serverless instances and cold starts. A generic receipt table would still need atomic coupling to each domain write. Storing the key on the row created inside the existing transaction makes the uniqueness guarantee share the same commit boundary. Multi-unit sales need a deterministic index because one client mutation intentionally creates several sale rows.
- **Migration:** Nullable fields and partial-use unique indexes are additive. Existing rows remain null and do not collide.
- **Rollback:** Stop sending/storing the header and drop the indexes/columns. Ledger values are unchanged.
- **Guards:** Duplicate acquire/sell helper tests, unique database constraints, and deterministic replay semantics; retries never create extra inventory, sales, or quantity decrements.

### A6. Quantity-changing sales lock the inventory row; cron RUNNING is a lease

- **Decision:** A sale transaction takes a parameterized PostgreSQL `FOR UPDATE` lock on its `InventoryItem` before reading quantity, planning units, inserting Sale rows and updating stock. `CronRun.status=RUNNING` is a 15-minute lease: fresh runs remain single-flight, while an expired lease is conditionally claimed and retried.
- **Why:** Idempotency keys prevent replay of the same command but do not stop two different commands from reading and overwriting the same stock quantity. Likewise, treating RUNNING as permanent turns one killed function into a job that can never run again. Conditional lease claim prevents two stale-run rescuers from both winning.
- **Rollback:** Remove the row-lock helper and restore permanent RUNNING skip semantics. No stored row shape changes, though doing so reintroduces the documented lost-update/stuck-job risks.
- **Guards:** Parameterized-lock contract test, multi-unit domain tests, fresh/stale lease tests, failed-retry persistence and existing idempotent failure-alert delivery test.

### A7. eBay OAuth uses random, signed, browser-bound state

- **Decision:** Every `/api/ebay/connect` redirect creates a cryptographically random nonce, signs it with an HMAC domain-separated by purpose, sends it as OAuth `state`, and stores the same value in a 10-minute HttpOnly/SameSite=Lax cookie scoped to the callback path. The callback verifies cookie equality and signature with timing-safe comparison before token exchange and clears the cookie on terminal responses.
- **Why:** Constant or unchecked state does not prevent login CSRF/account swapping. Cookie binding proves that the callback belongs to the browser that started consent; the signature makes state tampering evident without another database table.
- **Rollback:** Revert the state helper/connect/callback changes. No token or schema migration is involved, but rollback would restore the CSRF weakness and is not recommended.
- **Guards:** Randomness/signature/tamper tests, valid callback persistence test, and a negative test proving mismatched/missing state cannot call token exchange.

### A8. Leave the vulnerable Next 14 line; stage the smallest audit-clean framework upgrade

- **Decision:** Pin Next.js to the current security-backport release `15.5.20` while retaining React/React DOM `18.3.1`, and scope-override Next's bundled PostCSS to `8.5.16`. Convert dynamic route-handler params to Next 15's asynchronous contract. Do not combine this security move with a React 19 migration.
- **Why:** The locked Next 14 release reports high-severity production advisories and has no audit-clean patch on that major line. Next 15.5.20 is the smallest maintained backport target verified clean by the package audit, accepts React 18.3.1, and avoids the much larger Next 16/React 19 change during an already broad reliability pass. The exact PostCSS override closes its transitive advisory without admitting a future major.
- **Migration:** The only application API change is additive syntax in 18 dynamic handlers: await `params` before reading `id`. The data model, URLs, response shapes, rendering model, and middleware policy stay unchanged.
- **Rollback:** Restore the previous package lock and synchronous route-param signatures. No database or persisted-client state depends on Next 15. A rollback would reintroduce the audited vulnerabilities and is only an emergency escape hatch.
- **Guards:** Dependency audit with zero findings; full unit/overhaul/UX/pricing suites; plain TypeScript plus Next production build; all Playwright dealer/offline/golden paths; representative dynamic-route and Basic-auth/cron smoke checks.

### A9. Treat exact eBay UK sold items as condition-scoped evidence, not free-text overrides

- **Decision:** A checked RAW comp is headline-capable only when it has an exact NM/LP/MP/HP/DMG bucket, a distinct individual `ebay.co.uk/itm/...` URL, and an exact item price excluding postage, buyer-protection fees and hidden Best Offers. Store a canonical listing ID under a unique constraint, retain rejected/outlier observations in the audit receipt, and query/cache/history manual reviews by RAW condition. Two qualifying UK sold items may outrank foreign aggregates, but normal confidence and spread gates still decide whether an automatic offer is safe.
- **Why:** Search-result URLs are not unique evidence, eBay's displayed buyer total can include a protection fee, and a completed Best Offer page may not reveal the accepted item price. Combining those amounts—or NM and played cards—creates a false median. Provider-reported approximate counts also cannot borrow the much larger sample size of a correlated TCGPlayer signal. At £100 or more, a foreign-only RAW headline is useful context but not enough for an automatic dealer offer.
- **Migration:** Add nullable `condition` to `CompResult`; add nullable `condition`, `sourceListingId`, and fail-closed `priceBasis='UNKNOWN'` to `CheckedComp`; add condition lookup indexes and a unique listing-ID index. Existing observations remain visible but cannot silently become trusted evidence.
- **Rollback:** The migration is additive. Application rollback can stop reading the new fields; dropping indexes/columns is optional and should only happen after a ledger backup. No existing price, inventory or sale row is rewritten.
- **Guards:** Source-backed Rayquaza VMAX 218/203 eBay UK fixture, adversarial £450/£600/£750 versus £1k+ provider benchmark, duplicate/mismatched-item controls, price-basis and wrong-grade controls, IQR and gross-spread gates, condition-partitioned database/offline-cache tests, full pricing red-team suite, production build and browser/E2E checks.

### A10. Correct checked evidence by voiding, and consolidate only provable duplicate card identities

- **Decision:** Checked comps stay append-only. A correction sets `voidedAt` and a required `voidReason`; the row remains in receipts but cannot contribute to a sample. The active eBay listing ID is protected by a partial unique index, so voiding releases that exact item for a corrected re-log. Catalog duplicate cleanup is allowed only from a reviewed, hash-locked dry-run plan when game, language, normalized set/name, explicit edition/finish and collector-number identity agree.
- **Why:** Deleting or overwriting a bad sold observation destroys the explanation for a historical price. Keeping a full unique listing constraint forever makes honest correction impossible. Separately, provider rows such as `218` and `218/203` split evidence unless they converge on one card, but numerator-only matches must never bridge conflicting printed totals or card variants.
- **Migration:** Add nullable checked-comp void fields, replace the full listing-ID unique index with `WHERE "voidedAt" IS NULL`, and retain every existing row as active. Duplicate-card consolidation moves all card foreign keys and provider IDs to the preferred printed-total row in one serializable transaction after collision checks and a ledger backup.
- **Rollback:** Application rollback can ignore the nullable void fields. Database rollback or duplicate-card restoration must use the pre-operation ledger bundle; destructive reverse migrations are not automatic.
- **Guards:** Required/bounded void reason, idempotent concurrent PATCH behavior, void/re-log and global duplicate-listing tests, UI confirmation flow, exact 4.0× spread boundary test, provider-ID/printed-identity resolution tests, ambiguous-identity skips, plan hash/database fingerprint, relation uniqueness preflight, and post-apply duplicate/reference audit.

### A11. Guard the migration-owned partial index and serve the crawler policy publicly

- **Decision:** Treat `CheckedComp_sourceListingId_key` as an exact, migration-owned PostgreSQL partial unique index with `WHERE ("voidedAt" IS NULL)`, and verify its physical `pg_indexes.indexdef` whenever a database is available. Never run `prisma migrate dev` against a database that matters because Prisma cannot model this index. Exempt exactly `/robots.txt` from the production password middleware; no page, API route or broader static path is exempted.
- **Why:** Replacing the partial index with Prisma's full unique form silently breaks void-then-re-log correction. Serving a private app's `Disallow: /` policy behind a 401 prevents crawlers from receiving the policy even though application content remains gated.
- **Migration/rollback:** No schema or data change is introduced. Roll back the runtime guard or exact middleware equality check independently; do not recreate or alter the index outside its owning migration.
- **Guards:** Pure index-definition tests plus a cleanly skippable physical PostgreSQL assertion, deep-health visibility, exact-path middleware review, production smoke checks for `/` and private APIs remaining 401 while `/robots.txt` returns only the disallow policy, and the read-only `npm run drift:checked` audit for provider-versus-qualified-checked evidence.
