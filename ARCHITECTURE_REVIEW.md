# Poke Deal architecture and reliability review

Date: 2026-07-11
Baseline: `ARCHITECTURE_BASELINE.md` at Phase 0 commit `c4357fe`

## Outcome

The pricing mathematics and its six operating priors remain intact. This pass changes delivery and reliability around that core: one Prisma pool per runtime, pooled/direct Neon separation, progressive comp receipts, real source cancellation, durable scan budgets and corrections, durable offline mutation idempotency, a manual-check persistence/API seam, card price history reads, bounded Discord/Gemini calls, cron failure delivery, source freshness fields, CI gates, and a deterministic fixture-routed browser proof.

No money field or calculation moved away from integer GBP pence. `cleaning.ts` and `reconciler.ts` remain pure. No provider failure becomes a whole-lookup failure. No progressive event emits a naked price.

## Findings and actions

| Finding | Action | Why / no-action rationale |
|---|---|---|
| Production created a new Prisma client per call and the deployed Neon URL was direct/unpooled. | `getPrisma()` now reuses one global client in production. Prisma uses pooled `DATABASE_URL` at runtime and direct `DIRECT_URL` for DDL. | Both layers are needed: global reuse controls pools per warm isolate; the Neon pooler controls connections across isolates. Root verification measured the derived pooler at 492 ms cold and 31–35 ms warm for a direct client `SELECT`. |
| Listing item/state, stock reprice order, latest comp, cron status and scan correction queries lacked aligned indexes. | Added only query-backed, non-destructive indexes in `20260711120000_architecture_reliability`. | No speculative text/trigram indexes or uniqueness changes were added. Existing history indexes remain. |
| `/api/comps` serialized bare-query ambiguity ahead of fan-out and returned one monolithic JSON body. | One flow now backs legacy `GET /api/comps` and progressive `GET /api/comps/stream`. Ambiguity search, asks and comp fan-out overlap. | Existing clients keep the exact final JSON seam. NDJSON v1 is record/replay friendly and works with streaming `fetch`. |
| The 4 s source envelope returned a fallback but did not stop work. | `CompSourceContext.signal` now reaches Price Tracker, PokeTrace, eBay MI and Pokémon TCG catalog-market fetches; timers and caller cancellation abort the underlying request. | Database evidence sources have no remote fetch to abort. Adapter-local timeouts remain as a second boundary. |
| Partial prices could become misleading if ambiguity had not settled. | Bare queries reconcile provisionally with `ambiguous:true`; final receipt re-runs the pure reconciler with actual sibling evidence. | The progressive UI can become useful early without briefly overstating confidence. |
| Comp audit rows discarded reconciler/manual-check state. | Headline `CompResult` rows now store confidence, manual flag, reasons and a source receipt. `GET/PATCH /api/comps/reviews` lists/resolves them. | Reusing the append-only valuation row avoids a second review source of truth. Resolution updates metadata only; evidence remains immutable. |
| PriceSnapshot data had no focused per-card read contract. | `GET /api/cards/:id/price-history` returns snapshots, audit comps, acquisitions, listings and sales for a grade/range. | Values remain pence. This is a read-only seam for B's sparkline/full history UI. |
| Gemini had no timeout, parsed an unbounded JSON body, and used a reset-on-cold-start counter. | Scan bodies are streamed through an 8 MiB-ish hard cap before JSON parsing; decoded image size remains capped at 6 MiB; Gemini aborts at 12 s by default. Postgres reservations use an advisory-locked daily/session count and append `STARTED` telemetry before spend. Session fairness uses a stable device-session header, falling back to a bounded HMAC input derived from IP/UA; per-request mutation ids are explicitly excluded. | When Postgres is absent/unavailable, a bounded per-runtime guard remains an honest best-available fallback and the response/log says whether enforcement was durable. The global daily cap remains authoritative if fallback identity changes. |
| Scan observations had no latency/input/correction evaluation link. | `ScanEvent` records latency, request bytes, input kind, an HMAC session hash, and Gemini's optional prompt/output/total/cache/thought token counts. `POST /api/scan/corrections` appends an idempotent correction linked to the original event. | Raw session tokens are never stored. Original model observations are never overwritten. Provider usage is recorded as reported; no unstable pound-cost estimate is invented. |
| Offline queue replay could duplicate a buy or decrement stock twice after commit/response loss. | `X-Poke-Deal-Mutation-Id` is stored uniquely on acquisitions and as `(id,index)` on multi-unit sales. Duplicate requests replay HTTP 200 with `idempotent:true`. | An in-memory cache would fail across Vercel isolates. Domain-row uniqueness shares the commit boundary with the write it protects. |
| Two different sale mutation ids could concurrently read the same quantity and overwrite each other's decrement. | The interactive sale transaction now takes a parameterized `SELECT ... FOR UPDATE` lock on the inventory row before reading/planning/writing. | Idempotency and concurrency control solve different failure modes. The row lock serializes distinct legitimate sale commands and the second transaction sees the committed remaining quantity. |
| A killed cron function left a `RUNNING` row that every later invocation skipped forever. | RUNNING is now a 15-minute lease. Fresh rows remain single-flight; stale rows are reclaimed with a conditional update, retried, and persisted SUCCESS/FAILED normally. | Conditional claim prevents two recovery invocations from both owning the expired lease. Existing FAILED handling then creates the idempotent inbox/Discord failure alert. |
| eBay OAuth used predictable constant state and the callback never verified it. | Connect now issues random HMAC-signed state in a 10-minute HttpOnly/SameSite=Lax callback-scoped cookie. Callback verifies cookie binding and signature before exchange and clears it afterwards. | Prevents login CSRF/account swapping without storing another secret or database row. Production code can no longer omit state from `buildAuthUrl`. |
| Discord calls could hang; cron failures stopped at the inbox. | Discord has a 5 s abort budget, bounded payload and secret-free latency log. Daily/weekly failures now claim and dispatch an idempotent inbox alert to Discord; failed delivery reopens the claim. | Watch and reprice dispatch remain unchanged except they benefit from the bounded notifier. |
| eBay Browse asks were awaited by the terminal receipt without an end-to-end budget. | The ask lookup now has a 3.5 s overall boundary covering token acquisition, Browse fetch and mapping; caller cancellation aborts its fetch. Timeout/cancellation returns explicit `skipped` ask evidence and never changes reconciliation. | Active asks are secondary listing evidence, so a slow ask source must not hold the actionable sold-comp receipt open. |
| Health showed current probe state but not observed recency. | Deep/status health sources now include `lastSuccessAt` and `freshnessSeconds`; priced comp source successes also update the runtime registry. | This registry is runtime-local, not durable monitoring. It is intentionally described as observed freshness rather than an SLA history. A durable telemetry backend is deferred. |
| Merge safety depended on a local convention. | `.github/workflows/ci.yml` now starts disposable PostgreSQL, deploys every migration, then runs the full unit suite, focused overhaul and UX suites, production dependency audit, Prisma validation, pricing red-team, TypeScript, production build and all deterministic Playwright dealer/offline/golden paths. | GitHub branch protection was enabled after the first green run: `ship-gates` is strict and required on `main`, including for administrators; force-push and deletion are disabled. |
| Root LCP/TTI was 16–17 s because `refreshAll` gated first render on nine endpoints. | `refreshAll` now applies each independently settled dataset immediately and only writes the complete bootstrap cache when every request succeeds. Progressive comp events update the Buy decision separately. | An aggregate `/api/bootstrap` would preserve the same all-or-nothing gate and duplicate existing APIs. Independent settled loading is the lower-risk correction. |

## Authentication no-action review

No primary authentication model or middleware exception was changed in this pass. The app is explicitly single-operator: when `APP_PASSWORD` is set, HTTP Basic protects pages and same-origin APIs; cron routes accept only the separate bearer `CRON_SECRET`; provider credentials remain server-only. The offline service worker uses same-origin credentials and does not cache API responses. Replacing this with sessions, users or RBAC would be a one-way product/data decision with no current multi-user requirement, and would introduce avoidable risk to offline replay and cron access, so the existing boundary was retained. eBay OAuth's sub-protocol was hardened independently with random signed cookie-bound state.

This stance assumes HTTPS, a strong rotated app password, and a private single-dealer deployment. It is not an endorsement of Basic auth for a team product: before shared accounts, per-user audit or public links, move to managed session auth with CSRF protection and explicit authorization tests. One known integration edge is `/api/ebay/account-deletion`: an eBay-originated notification cannot answer the Basic challenge. A carve-out was explicitly considered and rejected because only GET challenge verification is token-backed; POST currently acknowledges without verifying an eBay signature. The endpoint therefore remains safely Basic-blocked. Before enabling it, implement and test eBay's signed-notification verification, then add an exact-path GET/POST middleware exception—never an API-wide bypass.

## Caching review

| Cache | Current policy | Action / deferral |
|---|---|---|
| PWA shell/static assets | Versioned Cache Storage; navigation network-first with shell fallback; API paths explicitly excluded. | Kept. This avoids serving stale ledger/API responses from the service worker. |
| Offline comp receipts | IndexedDB key locks card identity + grade; fresh for 6 h, visibly stale up to 7 d, expired afterwards. | Kept and tested by the UX/offline pass. It preserves the no-bare-number receipt rather than caching headline pence alone. |
| Last-known server comp | Postgres-backed latest headline, maximum age 7 d, returned with cached age/flag only when fresh sources have no price. | Kept. It is a resilience fallback, not a substitute for live fan-out. |
| Provider response caches | Catalog metadata 30 m (negative 1 m), Price Tracker 24 h, eBay asks 1 h, all runtime-local. FX has a daily Postgres cache with seven-day stale fallback. | TTLs and eBay daily spend cap were kept. Runtime Maps have no explicit LRU size cap; defer a shared/LRU cache until observed warm-isolate memory or hit-rate data justifies it. Serverless isolate lifetime and the solo workload bound current exposure, but this should be revisited before bulk catalogue traffic. |
| HTTP comp/API responses | Comp routes are `force-dynamic`; stream sends `Cache-Control: no-store, no-transform`. Ledger APIs are not service-worker cached. | Kept. User-specific stock, review state and progressive receipts must not enter a CDN/shared cache. |
| eBay active asks on terminal path | Previously TTL/budgeted but not latency-bounded. | Fixed: 3.5 s overall timeout plus abort propagation; failure degrades to a skipped, timestamped evidence object. |

## Progressive comp contract (v1)

Endpoint: `GET /api/comps/stream` with the same query parameters as `/api/comps`.
Content type: `application/x-ndjson; charset=utf-8`.
Types: `src/lib/comps/progressContract.ts`.

Successful order:

1. Exactly one `catalog`: requested and resolved card identity, grade, catalog record, ambiguity state and configured source list.
2. One `source` per settled source: live flag, status, latency, completed/total, full `CompResult`, and reconciliation over evidence so far.
3. A `verdict` after price-bearing progress: `provisional` for one priced source and `quorum` from two distinct priced sources. It carries a full `ReconciledComp`, not `headlinePence` alone.
4. Exactly one terminal `receipt`, whose nested receipt is the legacy JSON result, including catalog, alternatives, ambiguity, asks and image evidence.

Invalid/upstream lookup ends in exactly one terminal `error`. Every record has `version:1`, `lookupId`, monotonic `sequence`, and `emittedAt`.

## Schema migration and rollback

The production sequence was executed in the safe order:

1. A portable ledger backup was taken at `output/backups/20260711-170314Z/poke-deal-backup-20260711-170314Z.json`: 18 tables, 42,131 rows, 24,453,944 bytes, SHA-256 `b2709d4ca20aadd2279470af8487ef539e7f7c87b1b3a5df56a3687b15ab2b08`.
2. Runtime `DATABASE_URL` was changed to the matching Neon pooler and `DIRECT_URL` retained the direct DDL connection.
3. Additive migration `20260711120000_architecture_reliability` was deployed to production.
4. `prisma migrate status` reported the database up to date; all pre-migration table counts were preserved and the added columns were readable.

The migration contains nullable columns, safe boolean/default columns, foreign-key linkage for corrections, and query-backed indexes. Rollback is to stop writers/readers first, then drop the new constraints/indexes/columns listed in the migration. Inventory, sale, comp, and scan core rows were not rewritten. Exact rationale and guards are recorded in `DECISIONS.md` A1–A6.

## eBay contract audit

- Marketplace Insights: no additional adapter was built. The restricted endpoint, feature flag, UK query/filter mapper, sold-date/currency cleaning and captured `ebay-marketplace-insights-item-sales.json` fixture already have contract tests. Building another speculative layer would not reduce the external approval risk.
- Sell: no parallel adapter was added. Inventory-item payloads, condition descriptors, offer payloads, preflight, policy/readiness gates, Trading XML verification/publish parsing, OAuth and Fulfillment order imports already have deterministic mock/fixture contracts. The remaining blockers are seller eligibility/permissions and live configuration, not missing payload code.

## Verification and metrics

| Gate / path | Before | After this pass | Status / measurement note |
|---|---:|---:|---|
| Full unit suite | 743 pass | 786 pass | Green on the final release rerun; 43 additional assertions cover the new reliability, evidence, offline, image-transmission and listing paths. |
| Focused overhaul / UX | absent | 7 / 10 pass | Green: progressive delivery, offline policy/mutations, row locking and price-history UI. |
| Pricing red-team | 10 attacks, 0 fails | 10 attacks, 0 fails | Green; dedicated executable test also green. |
| TypeScript | pass | pass | Full shared `tsconfig.check.json` run green after architecture/UX integration. |
| Prisma schema | pass | pass | `prisma generate` and `prisma validate` green. |
| Browser dealer/offline/golden paths | absent | 4 pass | Real UI flows cover scan → receipt → buy → stock → draft → sold → profit plus two network-loss/replay cases. They are deterministic fixture-backed tests, not a seeded disposable Postgres run. |
| Photo → terminal receipt | ~11.666 s estimated | ~5.964–6.888 s derived local span | The final range combines the latest durable cold scan API probe (2.379 s) with three measured progressive terminal receipts (3.585–4.509 s). It is about 41–49% faster, but is a derived span rather than an end-to-end p95 trace. |
| Identity on simulated fast 4G | not measured; local model took 8.998–9.119 s | 1.342 s median / ~1.555 s p95 | A 42 KB scan payload and low-media-resolution model setting retained 12/12 semantic identity on the evaluation set. The strict <1.5 s p95 target is close but not proven. |
| Progressive comp after identity | none | catalog 2.755–3.658 s; quorum 3.362–4.509 s; receipt 3.585–4.509 s | Three live local production-build traces. Audit persistence is deferred with Next `after()`, removing the former 5–9 s terminal DB tail. |
| Inventory API | 0.792–0.944 s | 0.843–0.916 s warm | Comparable rather than materially faster; no regression outside baseline variance. |
| Dashboard API | 1.004–1.039 s | 0.573–0.599 s warm | Approximately 43% lower midpoint latency after pooling/index/loading work. |
| Today LCP / TTI | 16.120 / 17.073 s | 3.178 / 6.919 s | Mobile Lighthouse local production build: roughly 80% / 59% lower, with FCP effectively unchanged at 1.061 s. |
| Buy LCP / TTI | baseline root only | 5.304 / 6.304 s | Buy is the slowest final LCP, while Stock/List/Profit are 2.803–2.896 s. Progressive identity/verdict states arrive independently of the terminal receipt. |
| Lighthouse accessibility / best practices | 89 / 96 | 100 / 100 on all five views | Today, Buy, Stock, List and Profit each scored 100 for both categories. |
| Production dependency audit | not recorded | 0 vulnerabilities | Next `15.5.20`, React/React DOM `18.3.1`, and scoped PostCSS `8.5.16`; `npm audit --omit=dev` is clean. |
| Production build / root bundle | 18.00 s; 135 / 222 kB | 16.72 s; 145 / 247 kB | Build is 7% faster; root route / first-load JS grew 7% / 11% to support the offline/progressive UI. Shared JS is 103 kB and middleware 35.5 kB. |
| GitHub required gate | convention only | `ship-gates` passed and is required on `main` | The merge and the resulting `main` commit both completed the disposable-Postgres, unit, build and browser workflow successfully. |
| Production deployment | previous release | Vercel production `dpl_F1wc536RUKTM93g45msAakcVhTUC` | Canonical alias `https://poke-deal.vercel.app`; authenticated HTML/API/PWA probes, five production comp probes, progressive NDJSON and a durable scan all passed. |

## Deliberate deferrals

- `DISCORD_WEBHOOK_URL` is not available, so notifier, watch/reprice and cron-failure contracts are implemented and tested but a real channel delivery cannot honestly be claimed. Supply the secret and run a controlled alert before treating this exit criterion as complete.
- The fast-4G identity p95 is about 1.555 s in a three-sample compressed-image trace. This is materially faster and 12/12 semantically accurate in the broader 512px evaluation, but narrowly above the strict <1.5 s target; verify with a larger physical-device sample.
- DB-backed browser assertions: CI now deploys the migration set to disposable PostgreSQL before all gates, but Playwright remains a deterministic route-fixtured real-UI proof rather than a seeded ledger test. Add a seeded staging lane when an isolated fixture dataset is available.
- Immediate offline photo re-identification has no pixel fingerprint. Typed identity and recently viewed card receipts work offline with visible stale age; scan photos queue in order for reconnect.
- Durable cross-deployment source-success history and percentile telemetry: current structured logs/runtime freshness are useful but not a monitoring warehouse.
- eBay account-deletion POST remains Basic-blocked until official signed-notification verification is implemented. Marketplace Insights and Sell remain code-ready behind gates but depend on eBay approval/eligibility.
- Generic idempotency is deliberately scoped to acquire/Quick Fill and sell, the offline money/quantity-changing paths. Expand only when another mutation joins the durable queue.
- `src/app/page.tsx` remains a large client orchestrator (12,099 lines, up from 10,979 after the offline/progressive workflows). This is maintenance debt, not an unreported performance win; split it by screen/workflow after the release stabilises.

## Invariant evidence

- Integer GBP pence: unchanged schema/domain types; pricing, history, review, idempotency and golden-path fixtures use integer pence.
- No bare-number comps: `progressContract.test.ts`, `progressContract.ts`, and the golden path assert sample/window/confidence beside price.
- Pure cleaning/reconciler: no IO imports or edits in either core file; full and red-team suites green.
- Graceful degradation: `CompService` still returns empty/unavailable signals and cached fallback; timeouts now abort work as well.
- Card-agnostic domain: new APIs key by generic Card/grade; Pokémon-specific provider logic stays in adapters/routes.
- Ship gates: CI encodes disposable-Postgres migration deploy, production audit, Prisma validation, full/focused tests, red-team, typecheck, build and all browser proofs. GitHub now requires `ship-gates` on `main`; the post-deploy `verify:prod` run passed 5/5 live probes.
