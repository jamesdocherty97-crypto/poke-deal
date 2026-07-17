# PokeDeal API Audit, Repair, and Opportunity Brief

## Mission

Perform a complete, evidence-led audit of every API and external service used by PokeDeal. Determine what is genuinely live and reliable, what is only configured or fixture-backed, what is underused, and what needs attention. Fix every safe, reproducible, repository-owned API problem during the same goal. Then map the best product features PokeDeal can build from currently available or realistically obtainable API capabilities and data.

Do not stop at a plan or report. Continue through discovery, current official documentation research, safe live validation, implementation, regression testing, and an implementation-ready roadmap.

## Repository and starting context

Work in `/Users/jiddle/Desktop/Pokemon Dealer OS`.

Read any applicable `AGENTS.md`, then inspect at least `README.md`, `ARCHITECTURE_BASELINE.md`, `DECISIONS.md`, `USER_GUIDE.md`, `CODEX_BACKLOG.md`, `package.json`, `vercel.json`, environment templates, `prisma/schema.prisma`, API routes, cron jobs, provider adapters, fixtures, tests, health/status code, and recent audit reports. Historical documents are leads, not current truth.

Known integration leads include Gemini, Pokemon TCG API, TCGdex and catalog/image fallbacks, Pokemon Price Tracker, PokeTrace, TCGPlayer/Cardmarket market data, eBay OAuth/Browse/Sell Inventory/Fulfillment/Trading/business policies/account deletion/Marketplace Insights, PSA Public API, FX, Discord or generic alert webhooks, Vercel Blob, Neon/Postgres/Prisma, PokeDeal API routes, crons, caches, and offline clients. Discover anything missing from this list by searching HTTP calls, SDKs, URLs, environment variables, feature flags, OAuth scopes, callbacks, webhooks, scheduled work, and database models.

## Delegation

Use subagents for bounded parallel work where it improves depth or speed. Good initial streams are:

1. Repository integration inventory and call/data-flow tracing.
2. Current official provider documentation, capabilities, scopes, quotas, plans, and deprecations.
3. Existing test, fixture, health, production-verification, and operational evidence review.

Keep initial delegated work read-only. The primary agent owns the master inventory, prioritization, synthesis, and final verification. Delegate code fixes only with non-overlapping file ownership, and re-check every delegated conclusion and edit before relying on it. Do not allow parallel edits to collide in the shared worktree.

## Safety and authority

- Check Git status first. Preserve unrelated user work and avoid broad rewrites.
- Never expose secret values in chat, screenshots, reports, code, Git history, terminal output, or logs. Record only presence, absence, invalidity, expiry, or inaccessible state.
- Never ask the user to paste passwords, API keys, tokens, MFA codes, or connection strings into chat.
- Production validation must be read-only and non-destructive. Do not publish eBay listings or offers, alter real orders, send nuisance alerts, upload production test files, rotate or revoke credentials, change provider plans, deploy, commit, push, or perform destructive database work without explicit approval.
- Test write paths through mocks, fixtures, local isolation, or provider sandboxes.
- Use current official provider documentation as the source of truth. Record direct URLs and access dates. Clearly label inference.
- Preserve PokeDeal invariants: GBP integer pence below adapters; currency conversion at ingestion; evidence provenance, freshness, sample size, and exclusions; honest degradation; and pure domain/pricing modules with no network or framework coupling.

## Chrome account access

The user can log in to provider accounts through Chrome. When dashboard access would materially improve the audit, prompt the user at that point and state:

1. The provider.
2. Why access is needed.
3. What will be inspected or changed.
4. Whether the action is read-only or account-modifying.

Have the user enter passwords, passkeys, CAPTCHA, MFA, and consent directly in Chrome. After the user confirms login, continue using the authenticated Chrome session. Ask for explicit approval before creating, rotating, revoking, or changing keys; changing OAuth scopes, callbacks, webhooks, permissions, production configuration, subscriptions, or paid plans; or adding credentials to local/Vercel environments. Prefer secure direct entry into the correct environment and never transcribe secret values into the audit.

Do all independent work before waiting on an account login. Distinguish access needed to verify an integration, repair configuration, or unlock plan-gated functionality.

## Classification standard

Give every discovered integration one primary state:

- **Working well:** contract-correct, resilient, observable, and used by a real workflow.
- **Working but underused:** healthy, with valuable accessible capability or data left unused.
- **Partial:** an important market, grade, field, pagination path, workflow, or failure mode is incomplete.
- **Fixed this goal:** a repository-owned defect was reproduced, repaired, and verified.
- **Needs attention:** a repository-owned issue remains.
- **Externally blocked:** credentials, approval, configuration, entitlement, quota, or paid plan is required.
- **Fixture/fallback only:** demonstrations work but live operation is unproven.
- **Dormant/legacy:** obsolete, duplicated, compatibility-only, or not called.

Separately record whether each integration is implemented, configured, authenticated, invoked by a real app/cron path, returning valid live data, and influencing user-visible output. A `200` response or present environment variable is not proof that an API works.

## Phased execution

### Phase 0: Baseline and inventory

Capture Git state and run the existing baseline gates before edits:

- `npm test`
- `npm run test:overhaul`
- `npm run test:pricing-redteam`
- `npm run typecheck`
- `npm run build`

Build a traceable inventory from provider to adapter, internal route/cron, persistence, UI consumer, and business outcome. Note unused fetched fields, stored-but-unused data, duplicate calls, and fallbacks that can conceal outages.

### Phase 1: Contract and capability audit

For each provider, compare implementation with current official documentation. Record purpose, endpoints/methods, authentication and scopes, token lifecycle, feature flags, request/response mapping, fields retained/discarded/surfaced, pagination, batching, idempotency, rate limits, quota and cost, plan restrictions, webhooks, deprecations, cache/freshness rules, timeout/cancellation/retry behaviour, failure semantics, observability, security, and test coverage.

Validate identity dimensions where relevant: card, set, number, variant, language, condition, grading company, grade, currency, market, region, timestamp, sample size, and provenance.

### Phase 2: Safe validation

Use unit/contract fixtures first, then safe live checks where useful and authorized. Run existing relevant scripts when credentials and read-only access permit:

- `npm run health`
- `npm run verify:prod`
- `npm run health:cron`
- `npm run drift:comps`

For catalog/comps, cover modern raw, vintage raw, PSA graded, another supported grader, promo/subset numbering, ambiguity, no data, timeout/rate limit, conflicting sources, and stale fallback without wasting quota. Validate correctness and user-visible evidence, not only status codes.

For eBay, validate readiness, scopes, refresh, payload construction, business-policy/location dependencies, pagination, order-import idempotency, and error mapping without marketplace writes. For Gemini, PSA, FX, notifications, Blob, and database services, use safe probes or mocked contracts when live calls cost money or create state.

### Phase 3: Repair

For every feasible repository-owned problem: preserve failure evidence, identify root cause, add a regression test where practical, implement the smallest durable fix, run focused tests, then re-run relevant full gates. Prioritize incorrect mappings, silent fixture mode, masked outages, missing timeouts/abort propagation, unsafe retries, quota handling, missing pagination, currency/market/condition/variant/grade/timestamp errors, token/scope drift, weak health output, stale-cache semantics, duplicate calls, missing idempotency, secret risks, and valuable fields discarded too early.

Do not bypass provider restrictions or fabricate data. Mark external blockers honestly with the exact user or provider action required. Update documentation and environment templates when behaviour or setup changes.

### Phase 4: Untapped capability and features

Build a capability-to-feature matrix containing provider, documented capability/endpoint/data, current usage, unused data, proposed feature, dealer problem solved, user workflow/UI location, required schema/routes/jobs/cache/analytics, scope/quota/plan dependencies, data-quality and fallback design, business value, effort, operating cost, risk, confidence, and priority.

Explore evidence-led opportunities in comp confidence/history/liquidity/volatility/regional spreads/anomalies; card identity/variants/languages/catalog freshness; slab verification and grading decisions; eBay listing, inventory, offers, orders, and performance; sourcing watches and repricing; portfolio automation and alerts; scan correction/quality; FX; and provider health/quota diagnostics. Recommend only features tied to a real PokeDeal workflow and measurable value.

## Deliverables

Create `docs/API_AUDIT_2026-07-15.md` containing:

1. Outcome-first executive verdict.
2. Complete API/service inventory and system data-flow map.
3. Scorecard and evidence-based classification for every integration.
4. Detailed provider findings with official source links and access dates.
5. Repairs made, root causes, changed files, and before/after proof.
6. Remaining external blockers and exact next actions.
7. Security, resilience, latency, cost, quota, data-quality, and observability findings.
8. Untapped capability matrix.
9. `Now / Next / Later` feature roadmap.
10. Implementation-ready backlog tickets with acceptance criteria, dependencies, risks, and validation.
11. Commands run and final test/build results.
12. Explicit limitations and anything not proven live.

Leave all safe, feasible API fixes implemented and tested. Do not mark the goal complete until every discovered integration is classified, live versus fixture behaviour is explicit, feasible defects are repaired or precisely justified, current capabilities are mapped to dealer outcomes, and final verification is recorded.
