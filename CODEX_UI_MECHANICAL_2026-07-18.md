# Codex brief — mechanical UI cleanup (2026-07-18)

Scope: low-judgment, high-repetition cleanup deferred from the UI quality sessions recorded in
`docs/UI_QUALITY_HANDOVER_2026-07.md`. Read that report first (root-cause section) — it explains why
these sweeps matter. Everything here is mechanical: the design decisions are already made; your job
is consistent application plus verification.

Branch context: `codex/workflow-integration-hardening`, working tree contains the two completed UI
improvement passes (uncommitted). Do not commit, push, deploy, or touch env/production. The remote
Neon DB behind `.env` is real data — browse read-only, never trigger writes.

## Guard rails (all tasks)

- Change only `src/app/styles/*.css` plus the specific TSX lines named below.
- After each task: `npm run typecheck && npm run build`, then screenshot the six views
  (`/?view=today|buy|stock|list|profit|setup`) at 375 and 1280 against a local prod server
  (`APP_PUBLIC_ACCESS=true PORT=3000 npm run start`) and diff against `output/ui-audit/after/`.
  A layout that visibly breaks (overflow, wrap, clipped control) means revert that hunk, note it, move on.
- Never run `npm run test:e2e` while the prod server is serving `.next` — the dev server it spawns
  corrupts the build. Kill the server, run e2e, rebuild.
- Full gate when done: `npm test`, `npm run test:e2e`, axe scan (script pattern in
  `docs/UI_QUALITY_HANDOVER_2026-07.md` Phase 4), no new axe violations, no console errors.

## Task 1 — type-scale token migration in components.css

`src/app/styles/components.css` has ~334 `font-size` declarations; the dominant hard-coded values map
onto the token scale in `src/app/styles/tokens.css`:

| hard-coded | replace with |
|---|---|
| `font-size: 9px`, `10px`, `11px` | `font-size: var(--font-size-micro)` (12px) |
| `font-size: 12px` | `font-size: var(--font-size-micro)` |
| `font-size: 13px` | `font-size: var(--font-size-label)` |
| `font-size: 14px` | `font-size: var(--font-size-body-sm)` |
| `font-size: 15px` | `font-size: var(--font-size-body)` |
| `font-size: 16px` | `font-size: var(--font-size-body-lg)` |
| `.62rem`–`.72rem` stragglers | `var(--font-size-micro)` |

Do it in batches of ~30 declarations with a screenshot diff between batches (9→12px changes density;
watch: `.recent-intake-*`, `.item-badges .pill`, bottom-nav labels, `.quick-intake-actions` — if a
constrained control clips, leave that one at its current size and add a `/* deliberate: fits 52px column */`
comment). Do NOT touch `screens.css` media-query blocks that already exist to shrink mobile controls.

## Task 2 — off-palette color migration in components.css

Replace hard-coded hexes with tokens (same file):

- `#cfe6ff` (18×) and `#88c8ff` (12×) → `var(--color-info)` for text, `var(--brand-blue)` where it's
  an accent border/background tint
- `#fff4b0` / `#fff2a6` (20×) → `var(--brand-yellow)` (text) — check contrast stays ≥4.5:1 on its background
- `#f59e0b` (7×) → `var(--color-warning)`
- `#c7f7df` / `#dfffe7` → `var(--color-success)`

Where the token is visibly different from the hex (screenshot diff), keep the hex and log it in the
PR notes instead of forcing it.

## Task 3 — uppercase label grammar

43 `text-transform: uppercase` rules in components.css use letter-spacing values of 0, .025em, .04em,
.08em, 2px. Normalise every uppercase *label* (not wordmarks, not `.grade-badge`) to
`letter-spacing: var(--letter-spacing-label)` (.055em). Do not add uppercase anywhere new.

## Task 4 — dead-rule sweep

These duplicate/superseded blocks were identified during the audit; verify each is truly unused at
runtime (grep + computed-style check), then delete:

- `src/app/styles/screens.css` has a `@media not all { … }` block (~line 1083, "Superseded by
  styles/workbench.css") — the whole block is intentionally disabled; delete it.
- `components.css` defines `.inventory-filter-tabs` and `.inventory-filter-tabs button.selected`
  3× (lines ~762-800, ~9103-9120, ~9216-9230) all overridden by workbench.css:1003-1009 — remove the
  components.css copies once a screenshot diff of Stock at 375/1280 confirms no change.
- `components.css` ~line 8904 `.secondary-action` inside a dead media block (flagged in review) — delete.

## Explicitly NOT in scope for Codex

- `src/app/page.tsx` decomposition (12.8k lines) — mistake-prone, needs judgment; stays with the owner/Claude.
- List/Stock information-architecture changes — done in the July sessions; don't rework.
- Anything touching pricing, provider, eBay, or API code.
- Grade-badge colors (PSA red etc.) — deliberate brand encoding, leave alone.

## Definition of done

- All four tasks applied or per-line exceptions logged.
- Zero hard-coded `font-size: N px` under 14px left in components.css except logged exceptions.
- Full gate green (see guard rails). Update `docs/UI_QUALITY_HANDOVER_2026-07.md` checkpoint with
  what changed and screenshot evidence under `output/ui-audit/codex-mechanical/`.
