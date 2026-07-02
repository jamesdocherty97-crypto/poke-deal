# Codex prompt queue — run IN ORDER, one goal at a time, after CODEX_GOAL_2026-07-02C_ADDENDUM completes

Standing rules for EVERY goal below (paste applies implicitly; each goal must honour them):
- Gates after every phase: `npm test`, `npx tsc -p tsconfig.check.json --pretty false`, `npm run build`; finish with push + `npm run verify:prod` all five cards green.
- Never modify reconciler/deal-calc logic or thresholds without an explicit authoring brief; adapters may only change where a goal says so.
- Money = pence. New logic pure + unit-tested. Commit per phase. STOP and report on any gate failure you can't fix in-phase.
- Read USER_GUIDE.md first for current behaviour; update it at the end of each goal.

---

## Q1 — Trust the whole catalog, not five cards (comp QA sweep + fixture expansion)
Run a live QA sweep across the card categories the basket doesn't cover: Trainer Gallery (e.g. Gengar LOR TG06), Galarian Gallery, Shiny Vault, SWSH/SVP promos, vintage WOTC non-Charizard (e.g. Blastoise 2/102, Dark Charizard), Japanese-numbered input (expect graceful failure, not wrong card), PSA 9 slabs, BGS 9.5, CGC 10, and 3 deliberately misspelled/rough Quick Fill lines. For each: probe the local dev server, record headline/confidence/manualCheck/ambiguity, and judge plausibility. Categorize findings CRITICAL (wrong number presented confidently) / HIGH (wrong evidence or missing ambiguity) / MEDIUM (staleness, UX). FIX identity/alias/parser bugs found (set aliases, promo numbering, TG/GG number formats are fair game; reconciler is NOT). Capture every interesting response as a fixture test so the corpus grows from ~6 to 20+ cards. Deliver a QA report file (CODEX_QA_SWEEP_<date>.md) in the style of CODEX_LIVE_QA_2026-07-02.md. If you find a reconciler-level design flaw, do NOT fix it — document it with raw JSON for the design layer, exactly like the Charizard PSA 10 amendment loop.

## Q2 — Data safety: the ledger must be unlosable
This app is becoming the business's book of record; losing the DB must be a non-event.
1. `npm run backup`: exports EVERY table (inventory, listings, sales, costs, sessions, watches, snapshots, checked comps, settings) to a timestamped JSON bundle + per-table CSVs under output/backups/ (gitignored).
2. `npm run restore -- <bundle>`: restores into an EMPTY database, with row-count verification per table; refuses to run against a non-empty DB without --force.
3. Round-trip test: seed → backup → wipe (test DB) → restore → deep-equal.
4. A "Download backup" button in Setup that streams the JSON bundle to the phone.
5. Document the Neon point-in-time-recovery situation (what the current plan/retention actually provides) in DECISIONS.md; if PITR is not available on the current plan, say so loudly in the Setup health panel ("backups: manual only").

## Q3 — PSA cert lookup (make graded buying feel magic)
When buying a slab, the cert number should do the work:
1. Adapter for PSA's public cert verification API (env `PSA_API_TOKEN` if required; degrade gracefully without it). Input: cert number → { card name, set, number, grade, variety }.
2. Buy flow: a "Cert #" field (and it should parse from Quick Fill, e.g. "cert 12345678"); on lookup, auto-fill card/set/number/grade and run the comp for the CERTIFIED grade. Show a "PSA verified" chip on the comp receipt and store certNumber on intake.
3. Mismatch guard: if the dealer had already typed a card and the cert disagrees, show both and require a tap to choose — never silently overwrite.
4. Tests: adapter mapping from 2–3 mocked PSA payloads; mismatch flow; Quick Fill cert parsing.

## Q4 — Listing copy generator (sell faster on every channel, no API needed)
Until eBay Sell API is live, remove the copywriting drudgery:
1. Pure generator: stock row → per-channel listing copy. eBay: 80-char-max title in the conventional format (Pokemon TCG <Card> <Set> <Number> <Grade/Condition> + keywords), description block with condition/cert/postage boilerplate from settings. Cardmarket: comment string + condition mapping (NM/EX/GD). Vinted: casual title + description.
2. UI: "Copy for eBay/CM/Vinted" buttons on stock/listing rows (clipboard + toast), and a bulk "export drafts as eBay CSV" matching eBay's bulk-listing template columns.
3. Price plumbed from the listing's list price; grade wording exact for slabs ("PSA 10 GEM MINT", cert number included).
4. Settings: editable boilerplate blocks (postage terms, returns line). Tests on the generator (title truncation, slab vs raw wording, special characters).

## Q5 — Automation hygiene: the app works while you sleep
1. Verify/create Vercel cron: daily portfolio snapshot and weekly stock-health reprice check actually RUN in production (vercel.json schedules + a run-log table so Setup shows "last snapshot: <when>"). Idempotent handlers, auth-protected endpoints.
2. In-app alerts inbox: watch hits, reprice recommendations, failed cron runs land in a simple inbox with an unread badge on Today; wire the existing optional webhook delivery for off-app push if `ALERT_WEBHOOK_URL` is set.
3. Buy-watch checks run on the daily cron using cached/warm comps (respect the Q-source cooldowns; cap upstream calls per run and log skips).
4. Tests: run-log writes, idempotency (double-fire = one snapshot), inbox unread logic.

## Q6 — Live FX with honest fallback
1. FX provider behind `FX_API_KEY` (e.g. a free-tier daily-rate API): fetch once per day, cache in DB, all USD/EUR→GBP conversions read the cache.
2. Fallback chain: cached rate ≤ 7 days old → use with age shown; older/no key → current static rate WITH a visible "static FX" note on affected comp evidence rows; never fail a comp over FX.
3. Surface the rate + age in Setup health. Tests: cache read/refresh, fallback chain, pence rounding (round half up, convert before rounding).

---

## Human-gated (not Codex prompts — James's checklist, unblocks queued work)
- PokeTrace production API key → Vercel → redeploy → Setup shows ready.
- eBay portal session: keyset exemption, Cert ID, RuName, OAuth refresh token; submit Marketplace Insights application.
- On MI approval: set `EBAY_INSIGHTS_ENABLED=true` → the dark-launched UK sold comps go live (then ask the design layer for a verifier update to assert MI presence).
- After a week of real use: bring the calibration list (offers vs paid, false manual-check flags) back to the design layer.
