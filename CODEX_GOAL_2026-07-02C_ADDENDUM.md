# Addendum to CODEX_GOAL_2026-07-02C — resume instructions (from the spec author)

Resume CODEX_GOAL_2026-07-02C.md with these amendments. All original global rules and gates stand.

## A1 — Phase 1 exit criteria relaxed (design decision, not a concession)
- Finish the mechanical extractions with the established pattern: **Listings tab** and **Profit tab**, with their row/action components (that's where the bundle actually shrinks). One commit each.
- The **Buy tab may remain in page.tsx for now**. Do NOT attempt the 200-dependency full lift. Instead, extract Buy panels OPPORTUNISTICALLY during Phases 2–3: when a phase rewrites a panel (receipt skeleton, decision bar, Just-Bought-It sheet), move that panel into src/app/components/ as part of that work. Rationale: Phases 2–3 rewrite much of that UI anyway; lift-then-rewrite is double risk for zero user benefit, and Buy is the active tab at first paint so it gains least from lazy loading.
- Phase 1 gate becomes: Listings + Profit extracted and lazy, page.tsx strictly smaller than 9,033 lines, First Load JS reported before/after, all five tabs smoked.

## A2 — Then proceed with Phases 2 → 6 exactly as written
Reminder of the ordering intent: Phase 2 (perceived speed) and Phase 3 (decision bar) are the phases the user notices most — do not gold-plate Phase 1 at their expense. Phase 6 must end with a push and `npm run verify:prod` all-green.

## A3 — New scoped exception to the "don't touch src/lib/comps" freeze: paid-source rate-limit guard
Warm-up produced 403/429 from PokeTrace. Add a minimal client-side guard — this is the ONLY permitted change under src/lib/comps, and it must not alter reconciliation logic or adapter output shapes:
1. In the PokeTrace HTTP client (and any other paid-source client with the same risk), on a 429: respect `Retry-After` if present, else exponential backoff (1s, 4s), max 2 retries; on a second 429 or any 403, mark the source in a module-level cooldown (default 10 minutes) during which calls short-circuit to "source unavailable" (the existing absence path — reconciler already handles it honestly).
2. Warm-up specific: `warm-comps` drops per-run concurrency to 2, and if a source enters cooldown mid-run, continues with remaining sources rather than retrying per item (no per-item retry storms). Log a per-source summary line (calls, 429s, cooldowns) in the run report.
3. A 403 that persists across a cooldown cycle should surface in Setup health as "key problem" for that source, not be silently retried forever.
4. Unit tests: Retry-After respected; cooldown short-circuits; warm-up run completes with one source cooled down; no change to any reconciler test.

## Order of work
1. A3 (small, protects a paid quota — do it first while it's fresh).
2. A1 (Listings + Profit extraction).
3. Phases 2, 3, 4, 5, 6 of the original brief, with opportunistic Buy-panel extraction en route.
Commit per slice as before; push and full prod verification at Phase 6.
