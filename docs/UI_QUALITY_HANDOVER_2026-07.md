# UI Quality Handover — July 2026

Session: UI quality / usability / accessibility / frontend-performance review of Poke Deal OS.
Reviewer: Claude Fable 5 (Claude Code). Date started: 2026-07-17.

## Progress checklist

- [x] Repository discovery
- [x] Baseline browser review
- [x] Responsive screenshots
- [x] Accessibility review
- [x] Performance measurements
- [x] Workflow findings
- [x] Prioritised recommendations
- [x] Quick Wins selected
- [x] Implementation (QW1–QW5 in working tree, uncommitted)
- [x] After screenshots (`output/ui-audit/after/`, 6 views × 5 widths + targeted recaptures)
- [x] Final verification (all checks below green)

## Baseline record

- Starting branch: `codex/workflow-integration-hardening` (checked out from clean `main`; local `main` has one unpushed commit `21ae43d` — untouched)
- Starting commit: `ca096fc184efdefb1d6ca4cc9d94df9e84918411` ("Disable caching for private APIs")
- Git status at start: clean working tree
- Date: 2026-07-17
- PR under review: https://github.com/jamesdocherty97-crypto/poke-deal/pull/7
- Deployed test app: https://poke-deal.vercel.app (read-only inspection only; treat as confidential)

### Commands available (package.json)

`npm run dev` / `build` / `start` / `typecheck` / `test` / `test:overhaul` / `test:pricing-redteam` / `test:ux` / `test:e2e` (mocked, port 3110) / `npm audit`. No standalone lint. Lighthouse via CLI against local production build. `npm run visual:punchlist` exists (scripts/capture-visual-punchlist.mts).

### Key discovery facts

- Workspaces are client-side views inside `src/app/page.tsx` — **12,815 lines**, single client component.
- Styles: `src/app/styles/` — tokens.css (332), base.css (613), components.css (**9,233**), screens.css (1,491), workbench.css (1,587).
- Focused components in `src/app/components/`: TodayTab, BuyComponents, InventoryTab, ListingsTab, ProfitTab, SettingsTab, ManualReviewQueue, PriceHistory, InventoryPhotoTools, UiBits.
- Prior visual audits exist under `docs/visual-audit/` (v0–v6, punch lists) and `output/lighthouse/{baseline,after}`.
- E2E: Playwright with fully mocked APIs, dev server port 3110 (`e2e/`).
- Production gate: Basic auth middleware; local prod audit uses `APP_PUBLIC_ACCESS=true` (test-only).
- Prior reported first-load JS: ~267 kB (to remeasure).

### Routes and viewports planned

Routes: `/` (workspaces: today, buy, stock, list, profit, setup — client-side tab views), `/privacy`.
Viewports: 375×812, 768×1024, 1280×800, 1920×1080; spot checks at 320px, 200% zoom, reduced motion, keyboard-only.

## Phase log

### Phase 0 — discovery (complete)

Read AGENTS.md, package.json, next.config.mjs, playwright.config.ts. Branch checked out. Next action: start app locally (prod mode if DB available, else dev with e2e mocks), begin baseline screenshots into `output/ui-audit/before/`.

## Findings

### Phase 1 — baseline browser review (375 + 1280 complete; 320/768/1920 matrix running)

Local prod server: `npm run build` then `APP_PUBLIC_ACCESS=true PORT=3000 npm run start` (DB = remote Neon; **read-only browsing only — no writes performed**). Build re-measured: `/` route **164 kB + 103 kB shared = 267 kB first-load JS** (matches prior report). Middleware 35.5 kB.

Screenshots: `output/ui-audit/before/{view}-{width}-full.png` for view ∈ today,buy,stock,list,profit,setup; width ∈ 375,1280 (+320,768,1920 via script; metrics in `before/matrix-metrics.json`).

Measured page heights at 375px width: buy 1861px, today 2448px, stock 2300px (only 4 holdings!), profit 5091px, **list 5663px**, **setup 8878px**.

Key observations per workspace (visual judgment unless noted):

- **Today (mobile+desktop):** Hero + Priority One + quest log + Sale Ready + Dealer pulse + alerts all compete. Desktop 1280: left column ends at ~960px, right column ~1640px → large blank dead zone under "Next moves" (measured from screenshot). Alerts box mixes costs prompt, eBay automation setup notice, and buy-target alert in one grey block.
- **Comp/Buy:** Hero occupies most of first mobile screen. Desktop is a stretched single column (~1200px-wide buttons/tabs). Recent buys: every row has 4 equal-weight full-width buttons (Again/Comp/Pack|List/Sell). Search placeholder truncated at 375. Buy-defaults row crams a right-aligned second column of micro-copy.
- **Stock:** Every holding card carries: grade badge + IN STOCK badge + NEEDS PHOTOS badge + sparkline + nested CTA box with explanation + 3 buttons. 4 holdings → 2300px mobile page. Desktop 2-col grid has visibly unequal card heights. Filter tab strip overflows horizontally even at 1280 ("Sold" clipped at edge).
- **List:** Worst page. Mobile 5663px. Sales-desk card truncates mid-word ("Salva tore 212/ 162", "READY T…") at 1280. ALL-CAPS "RECOMMENDED: TURN THIS STOCK ROW INTO A CHANNEL-READY DRAFT" repeated on every queue row. "Listing queue" and "Listings" sections repeat near-identical cards for the same items. Pack-builder "Download pack" is a huge primary button even with 0 selected.
- **Profit:** Profit-trend chart is a mostly-empty dark box with a flat line pinned to the top edge. Full inline cost-entry form lives on the analytics page. Red primary buttons (Snapshot stock value / Check buy targets / Add cost / Check reprices) compete — red no longer signals priority. Buy-watch rows: 3 buttons each (Save/Pause/Delete) always visible.
- **Setup:** 8878px mobile. ~17 provider rows fully expanded, each repeating "No live response recorded yet." and "Configuration only". Desktop has a Setup-map side nav (good) but all sections still render expanded.

### Phase 2 — root-cause diagnosis (code evidence, measured)

The token system (`tokens.css`, BRAND.md v2) is genuinely good — semantic layers for confidence/verdict/freshness, light theme, reduced-motion. **The jank is that `components.css` (9,233 lines) largely bypasses it:**

- 334 `font-size` declarations; top values hard-coded: 104× `11px`, 92× `12px`, 39× `13px`, 31× `10px`, 3× `9px`, plus stray `.62rem`–`.76rem` values. The type scale in tokens (micro=12px … display) is ignored → dozens of ad-hoc sizes → "inconsistent type" feeling + sub-legible 9–11px text.
- Padding: 235 hard-coded numeric paddings vs **8** using `var(--space-*)` → spacing grid not actually applied.
- Off-palette hard-coded colors in components.css: `#cfe6ff` (18×), `#fff4b0` (17×), `#88c8ff` (12×), `#f59e0b` (7× — amber not in the token palette), etc.
- 43 `text-transform: uppercase` micro-labels with varying letter-spacing (2px, .08em, .04em, .025em, 0…) → shouty, non-uniform label grammar.
- `src/app/page.tsx` is a single 12,815-line client component; all six workspaces ship in one 164 kB route bundle.

Hypothesis verdicts (from the Phase-2 list): nested-surface overload CONFIRMED (Stock/List); weak action hierarchy CONFIRMED (equal-weight button rows, red overuse); inconsistent spacing/type CONFIRMED (measured above); display-type overuse CONFIRMED (every workspace opens with a display-size hero + kicker); mobile page length CONFIRMED (measured); List/Setup simultaneous exposure CONFIRMED; repeated labels/noise CONFIRMED ("RECOMMENDED…", "No live response recorded yet." ×17); accent competition CONFIRMED (red = brand accent AND primary action AND danger); unbalanced wide layouts CONFIRMED (Today desktop dead zone); technically-responsive-not-composed CONFIRMED (Buy desktop is stretched mobile).

### Phase 4 — accessibility (measured)

- Landmarks/headings: proper (`main`, labelled `nav`, `aside`, one `h1` per view). Skip link present and focusable.
- Keyboard: visible focus outline on all first-15 tab stops on Today; no traps found in spot checks.
- Touch targets: zero interactive elements under 24×24 on Today (scan); primary actions ≥44px.
- axe-core 4.10.2 (WCAG 2.0/2.1/2.2 A+AA), 6 views × 2 viewports: **only 2 violations**, both `color-contrast (serious)`, 1 node each:
  - `stock-mobile`: `.selected > span` — the count chip inside the selected "Needs action" filter tab.
  - `setup-mobile`: `.state-missing td .provider-status-badge` — MISSING badge.
- Full results: `output/ui-audit/before/axe-results.json`.
- Matrix scan: **no horizontal document overflow at 320/768/1920 on any view; zero console errors; zero failed requests** (`before/matrix-metrics.json`).

### Phase 5 — performance (lab, Lighthouse 12, local prod build)

| Mode | Perf | A11y | BP | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| Mobile (throttled) | **0.85** | 1.0 | 0.96 | 0.66* | **3.9 s** | 0 | 40 ms |
| Desktop | **1.0** | 1.0 | 1.0 | 0.66* | 0.8 s | 0 | 0 ms |

*SEO 0.66 is by design (private app, noindex/robots disallow) — not a defect.

- Total transfer 626 KiB, 33 requests (mobile run). First-load JS 267 kB (`/` = 164 kB route + 103 kB shared).
- Mobile LCP element is the **decorative hero illustration** (`buy-stage-card brand-art`, `fetchpriority=high` on an `alt=""` image) — the app is paying its worst metric for decoration.
- Render-blocking CSS: 4 chunks, up to 612 ms (26k lines of CSS across 5 files).
- Verdict: performance is respectable; the "janky" feeling is **visual/compositional, not speed** (CLS is 0). JSON reports in `output/ui-audit/lighthouse/before-{mobile,desktop}.json`.

### Phase 3 — workflow findings (visual judgment on captured evidence)

**Today.** The three-second priority test *passes on desktop* (Priority One block is unmistakable) but the page then re-litigates the same information: quest-log item 01 duplicates the Priority One card; Dealer pulse duplicates Profit; Sale Ready duplicates List's sales desk. Desktop composition is broken: left column ends ~960px, right runs ~1640px (dead zone). The alert box merges three unrelated things (costs nudge, eBay-automation setup note, buy-target alert).

**Comp/Buy.** Fast path is clear (Scan primary, type secondary — correct hierarchy here). But desktop is a stretched phone layout: full-width 1200px buttons and grade tabs. The 1–4 stepper chips appear *below* the fold disconnected from the form they describe. Recent-buys rows give Again/Comp/Pack/Sell identical weight — no "next best action". Mobile: hero eats ~45% of first screen; search placeholder truncates.

**Stock.** A 4-holding collection produces a 2300px mobile page — each card spends ~500px on badges, sparkline, an explanation box, and 3 buttons. Grade badge (PSA 9) uses danger-red styling — reads as an error. "Needs action" tab red + yellow-tint selected surface clash (and fail AA, measured). Desktop grid cards have unequal heights (nested CTA boxes differ). Filter strip clips its last tab with no affordance beyond a 3px scrollbar.

**List.** The workspace exposes five surfaces at once (Listing desk, Sales desk, CSV exports, Pack builder, search/filters) *before* the actual queue. Queue rows and the "Listings" section below render near-duplicate cards for the same inventory — the same Pikachu appears in both with different affordances. Every queue row shouts an identical ALL-CAPS recommendation (`.listing-next-action span`, 11px/1000/uppercase). Sales-desk card mid-word-breaks card names ("Salva tore") due to `overflow-wrap: anywhere` on a 92px-min column. Record sale is findable but visually equal to a dozen other controls.

**Profit.** Metric hierarchy exists (NET P&L dominant) but the trend chart is an empty dark box with a line pinned to its top edge — it communicates nothing at current data volume. The inline cost-entry form + buy-watch management on the analytics page makes it half-dashboard half-admin. Save/Pause/Delete always visible on every watch row. Red used for four different non-destructive primaries.

**Setup.** Best-structured desktop view (side "Setup map") but nothing is progressively disclosed: 17 provider rows × (name, description, role, "No live response recorded yet.", "Configuration only", badge) all render — 8878px on mobile. The provider table's mobile fallback works (data-label pattern) but statuses repeat identical copy 17×. Autosave notice exists ("Changes save automatically") — good. Reset copy / Reset deal rules sit un-guarded visually next to ordinary controls (behavioral guard not verified — not tested to avoid writes).

### Phase 6 — report

**1. Executive verdict.** The app is functionally coherent, fast on desktop, and far more accessible than typical internal tools (axe: 2 nodes total). It looks janky because the well-designed token system is not actually enforced: 40+ ad-hoc font sizes, 235 hard-coded paddings, off-palette colors, and a last-loaded stylesheet (workbench.css) that overrides the intended action hierarchy — most damagingly styling *secondary* actions identical to primary red. Composition, not components, is the second failure: every workspace opens with a display hero, then stacks every panel it owns, expanded, in one column.

**2. What works.** Token architecture + BRAND.md grammar; semantic HTML/landmarks/skip link; visible focus everywhere; 44px targets; zero CLS; zero console errors; evidence-first pricing UI; distinct brand identity worth preserving; light theme + reduced-motion authored.

**3. Why it feels janky (ranked).**
1. Action hierarchy is flattened — `.secondary-action` rendered as solid red primary (workbench.css:500-509 selector list includes it; overrides components.css:2093's intended quiet blue). Red also = danger = brand accent.
2. Type anarchy: 334 font-size declarations, dominated by 9–13px hard-coded values; uppercase/weight-1000 micro-labels shout from every card.
3. Everything-expanded composition: mobile pages 2300–8878px; desktop leaves dead zones (Today) or stretches phone layouts (Buy).
4. Redundant surfaces: same entity rendered 2–3× per workspace (List queue vs Listings; Today vs everything).
5. Nested-box grammar: card > badge row > explanation box > CTA box > button row, each with its own border+background.

**4. Three highest-leverage corrections.**
- Restore the primary/secondary/ghost button contract app-wide (small CSS, huge effect).
- Enforce the token type scale in components.css/workbench.css (mechanical, medium effort, transforms perceived quality).
- Compose per-viewport: cap masthead height, two-real-columns on ≥1024px with balanced content, collapse secondary panels behind disclosure on mobile.

**5. Findings by severity.**
- *Critical:* none functional.
- *High:* H1 secondary=primary red override (workbench.css:500); H2 AA contrast failures ×2 (stock selected tab workbench.css:1008; provider MISSING badge workbench.css:1243); H3 List information architecture duplication; H4 Setup/List mobile page length; H5 decorative hero art is mobile LCP (3.9s, `eager` on aria-hidden art, page.tsx:7787).
- *Medium:* M1 mid-word breaks in desk cards (`overflow-wrap:anywhere`, components.css:7187/7404); M2 ALL-CAPS repeated recommendation strip (components.css:7396); M3 Today desktop dead zone; M4 stock filter strip clipping affordance; M5 PSA-grade badge uses danger styling; M6 four red primaries on Profit; M7 render-blocking CSS 612ms; M8 10–11px metadata text below comfortable legibility.
- *Low:* L1 truncated search placeholder at 375; L2 buy-defaults crammed dual-column micro-copy; L3 empty trend chart at low data volume; L4 "No live response recorded yet." ×17; L5 stepper chips disconnected below fold.

**6. Screenshots:** `output/ui-audit/before/` — 6 views × {375, 1280 (hand-captured), 320, 768, 1920 (scripted)} + `matrix-metrics.json` + `axe-results.json`.

**7. Design-system assessment.** tokens.css is the strongest artifact in the codebase; the failure is adoption. workbench.css (newest layer, loads last) re-styles shared classes globally instead of scoping, producing 4 competing definitions of e.g. `.inventory-filter-tabs button.selected`. Recommend: components migrate to semantic tokens file-by-file; workbench.css additions must scope under a workspace class; add a stylelint pass banning raw px font sizes and hex colors outside tokens.css.

**8. Accessibility results:** see Phase 4 (2 axe nodes; strong keyboard/landmark/target discipline).

**9. Performance:** see Phase 5 (mobile 0.85 / desktop 1.0; LCP 3.9s mobile from decorative art; 267 kB first-load JS; CLS 0).

**10. Roadmap.**
- *Quick Wins (selected for this session):* QW1 restore `.secondary-action` quiet style; QW2 fix both AA contrast failures via a `--color-danger-text` token; QW3 de-shout recommendation strips (case/weight/size); QW4 stop mid-word breaks in desk cards; QW5 drop `eager` from the decorative buy-hero art (LCP).
- *Focused Improvements (1–2 days each):* List IA merge (queue + listings into one stateful list); Setup progressive disclosure (collapse provider rows to status-line + expand); Today desktop two-column rebalance; Stock card slimming (badge consolidation, actions to overflow); Buy desktop composition (max-width form column + side summary); type-scale enforcement sweep.
- *Deeper Work:* decompose page.tsx (12.8k lines) into per-workspace lazy client components (also cuts 164 kB route JS); consolidate 4 stylesheets into scoped modules; virtualize stock/list at scale; unify the three "next action" systems (Today queue, List recommendations, Stock CTAs) into one.

**11. Top ten next actions (impact × confidence ÷ effort):** 1. QW1 hierarchy fix · 2. QW2 contrast · 3. QW5 LCP art · 4. QW3 de-shout · 5. QW4 word breaks · 6. Setup provider collapse · 7. List IA merge · 8. Stock card slimming · 9. Today rebalance · 10. page.tsx decomposition.

**12. Recommended visual direction.** Keep the navy command-centre + Pokémon warmth; make *red scarce* (one true primary per screen), yellow = attention/selection, blue = information/links, green = money-good. Micro-labels: one uppercase style (12px/650/+0.05em) used only for section kickers; body metadata 12–13px sentence case. One border+background level per card; inner groupings by spacing only.

**13. Verification log:** build ✅ (267 kB), typecheck/tests pending post-implementation, axe before-scan saved, Lighthouse before saved (mobile 0.85/desktop 1.0), matrix overflow scan ✅ clean, console ✅ clean.

### Phase 7 — Quick Wins implemented (working tree, no commit)

1. **QW1 — action hierarchy restored.** [workbench.css](../src/app/styles/workbench.css) ~line 500: removed `.secondary-action` from the solid-red primary selector list; gave it an explicit quiet info-blue treatment (`--color-info-*`). Affects 5 call sites (grade-EV lookup, watch create, profit snapshot, sell-next, page.tsx:9870) — all genuinely secondary.
2. **QW2 — AA contrast.** New token `--color-danger-text` (dark `#f5a7ac` ≈5.1:1 on tinted panels; light reuses `#a72d49`) in [tokens.css](../src/app/styles/tokens.css). Applied to selected inventory filter tab (workbench.css:1008) and fail/problem/missing provider badges (workbench.css:1243).
3. **QW3 — de-shout.** [components.css](../src/app/styles/components.css): `.listing-next-action span` drops uppercase + weight 1000→600, 11px→`--font-size-micro`; `.next-action-strip span` weight 900→600, 11px→token.
4. **QW4 — no mid-word breaks.** `.listing-desk-card strong` and `.listing-next-action strong`: `overflow-wrap: anywhere` → `break-word` ("Salva tore" fixed).
5. **QW5 — LCP.** [page.tsx](../src/app/page.tsx) buy masthead `CardImage`: removed `eager` so the decorative `alt=""` art no longer loads with `fetchpriority=high` as the mobile LCP element.

Tests after implementation: `typecheck` ✅ · `test:ux` 14/14 ✅ · `test:overhaul` 12/12 ✅ · `test:pricing-redteam` 1/1 ✅ · `npm run build` ✅ (267 kB unchanged — CSS-only).

Operational note: first after-capture run was invalid — old `next start` survived a `pkill` (EADDRINUSE in prod-server2.log) and served a mismatched rebuilt `.next`. Resolved via `lsof -ti :3000 | xargs kill` + clean restart; matrix re-run.

### Phase 8 — verification results (final)

Two follow-up fixes made after inspecting after-screenshots (both in the same files):
- `break-word` caused the sales-desk title to overlap the Record sale button (grid min-content sizing ignores break-word). Reverted to `anywhere` + `hyphens:auto`, **and** stacked the sales-desk card (`.sales-desk-panel .listing-desk-card` 2-col with button under copy, mirroring the existing mobile pattern) — "Salvatore 212/162" now renders on one clean line at 1280 with nothing truncated.
- Note for future sessions: running `npm run test:e2e` (dev server) while `next start` serves the same `.next` corrupts the prod server's assets — rebuild + restart afterwards before capturing anything.

| Check | Before | After |
|---|---|---|
| axe violations (12 scans) | 2 (contrast, serious) | **0** |
| Lighthouse mobile perf | 0.85 | **0.92** |
| Mobile LCP | 3.9 s | **3.3 s** |
| Lighthouse desktop perf | 1.0 | 1.0 (LCP 0.8→0.7 s) |
| CLS | 0 | 0 |
| Console errors / failed requests (30 view×viewport loads) | 0 / 0 | 0 / 0 |
| Horizontal overflow (320–1920) | none | none |
| typecheck | ✅ | ✅ |
| unit: test:ux / test:overhaul / test:pricing-redteam | — | 14+12+1 pass, 0 fail |
| e2e (dealer-loop, golden-path, offline-buy, pricing-semantics) | — | **11/11 pass** |
| `npm run build` | ✅ 267 kB | ✅ 267 kB (CSS-only diff) |
| `npm audit` | — | 0 vulnerabilities |

Diff: `src/app/page.tsx` (−1 line: `eager`), `tokens.css` (+3), `components.css` (13 lines touched), `workbench.css` (+16/−4). No business logic, API, schema, or production-config changes. No writes to the remote DB at any point; the deployed Vercel app was never load-tested or mutated.

### Phase 9 — Focused Improvements (session 2, 2026-07-18, same working tree)

Implemented on top of the Quick Wins (all uncommitted):

1. **Today desktop rebalance** — moved the Sale Ready card from the status rail into the quest-log column ([TodayTab.tsx](../src/app/components/TodayTab.tsx); `.priority-queue .sale-ready-sleeve` margin in workbench.css). Measured: today@1280 1726→**1463px**, columns now end nearly level; dead zone eliminated. Trade-off: today@768 grew 2148→2427px (sale-ready stacks inside the padded queue panel) — candidate micro-fix noted below.
2. **Setup provider slimming** — un-checked providers no longer repeat "No live response recorded yet."/"Configuration only" ×17; placeholder cell hidden on mobile, setup hints clamped to 2 lines ([SettingsTab.tsx](../src/app/components/SettingsTab.tsx), workbench.css mobile table block). Measured: setup@375 8926→**7294px** (−18%), setup@320 9546→7657, setup@1280 4153→3923.
3. **Buy desktop composition** — recent-buys actions now sit inline right of each row at ≥1024px instead of a full-width 4-button strip (workbench.css desktop media block). Measured: buy@1280 1909→**1738px**; rows read as a ledger.
4. **Stock flag dedup** — "Needs photos"/"Needs real photo" chips no longer render when the Add-photos action strip is already showing the same message (page.tsx). Also `role="group"` added to the flags row (fixes an `aria-prohibited-attr` axe finding surfaced this session).
5. **Profit trend honesty** — the sparkline renders only with ≥2 points; below that it shows "Trend starts with your next booked sale." instead of an empty box with a pinned line ([ProfitTab.tsx](../src/app/components/ProfitTab.tsx)).
6. **Micro-label legibility floor** — 21 workbench.css label/badge font sizes raised from .61–.68rem to .7rem (11.2px). Width-constrained mobile controls (bottom nav, quick-intake buttons) deliberately left as-is.
7. **Copy** — comp search placeholder "Umbreon prismatic, Victini promo…" → "Name, set, number…" (was truncating at 375; now also describes the expected format).

Verification (final state): typecheck ✅ · **full unit suite 865/865** · overhaul 12/12 · redteam 1/1 · **e2e 11/11** · build ✅ 267 kB · axe **12/12 clean** · Lighthouse mobile 0.92 / LCP 3.4s / CLS 0 · console+network clean ×30 loads · no horizontal overflow 320–1920. After-matrix heights in `after/matrix-metrics.json`.

Grade badges (PSA red etc.) were evaluated and deliberately **not** changed — the colors encode grading-company brands with a spine stripe, not danger.

Post-implementation review (code-review, medium): 2 candidates — (1) CONFIRMED: flag-dedup left the "Stock tasks" group renderable while empty (eBay-listed item with 0 photos, no other flags) → outer condition fixed to `(needsListing || (needsPhotos && !needsEbayPhotos) || photoCount > 0 || needsReprice)`; (2) `eager` removal flagged as possible accident → refuted: deliberate, measured LCP win on a decorative `alt=""` image, consistent with AGENTS.md "defer offscreen media". The ineffective `.masthead-actions .primary-action` cap was removed as dead code. Re-verified after fixes: typecheck ✅, build ✅, all six views load with 0 console errors.

### Phase 10 — List IA + Setup disclosure (session 3, 2026-07-18, same working tree)

High-value, judgment-heavy items implemented directly; mechanical sweeps deferred to
[CODEX_UI_MECHANICAL_2026-07-18.md](../CODEX_UI_MECHANICAL_2026-07-18.md).

1. **List pipeline reorder** ([ListingsTab.tsx](../src/app/components/ListingsTab.tsx)) — Pack builder and the three CSV export links moved from *above* the toolbar to *below* the Listings list they operate on. The page now reads desks → search → queue → listings → bulk tools. Pack-builder hint updated to "select listings above → channel → download or copy".
2. **"Listing queue" renamed "Stock to draft"** — kills the two-listing-lists illusion; the section is unlisted stock, and now says so. (e2e-pinned "Listings" heading untouched.)
3. **Queue-row photo tools collapsed** — `InventoryPhotoTools` per queue row now sits behind a `details` summary ("Photos · N" / "Add photos"), reusing the existing `row-more-actions` pattern; the fast path (Draft + pack) is the only expanded action.
4. **Setup provider disclosure** ([SettingsTab.tsx](../src/app/components/SettingsTab.tsx)) — the provider table defaults to rows needing attention (missing/fail/problem/info) with an aria-expanded toggle "Show all N providers"; shows everything when nothing needs attention.
5. **today@768 regression mitigated** — sale-ready sleeve tightened (112px art column, 12px margin) under 1024px: 2427→2391px (baseline 2148; the remaining delta is the Sale Ready card content itself now living in the flow).

Cumulative page heights, baseline → now: setup@375 **8926→4878 (−45%)**, setup@320 9546→5113, setup@1280 4153→3065, list@375 5663→5479, list@320 6755→6281, today@1280 1726→1463, buy@1280 1909→1738.

Final verification: typecheck ✅ · unit 865/865 ✅ · e2e 11/11 ✅ · build ✅ 267 kB · axe 12/12 clean · overflow/console matrix ×30 clean. After screenshots refreshed for list/setup/today at changed viewports.

## Checkpoint / continuation

### July UI landing and deployment

The Phase 7–10 working tree was cross-checked hunk-by-hunk against this handover; every source hunk was accounted for and no undocumented application change was found. It landed as three commits:

1. [`76e2041` — restore action hierarchy and AA contrast quick wins](https://github.com/jamesdocherty97-crypto/poke-deal/commit/76e2041255030e348d0f802109cf448733160520)
2. [`6d23723` — rebalance Today and compact Buy and Stock states](https://github.com/jamesdocherty97-crypto/poke-deal/commit/6d23723d7932b317399fd20b962b84f60aa0614c)
3. [`fdcaaaa` — reorder List pipeline and add Setup disclosure](https://github.com/jamesdocherty97-crypto/poke-deal/commit/fdcaaaabd6de9c8ab27ebd1b31baaa3f3926f66f)

[PR #7](https://github.com/jamesdocherty97-crypto/poke-deal/pull/7) was refreshed with the measured evidence (axe 2→0, Lighthouse mobile 0.85→0.92, Setup mobile −45%, Today desktop dead zone removed), made ready after the local full gate, and merged to `main` as [`618a670`](https://github.com/jamesdocherty97-crypto/poke-deal/commit/618a6706cbd7a0ec37cc166acb3196893d759135). Local `main` was fast-forwarded, so its previously unpushed `21ae43d` remains in the merged ancestry; it was not reset or discarded.

Landing verification: typecheck ✅ · unit 865/865 ✅ · overhaul 12/12 ✅ · pricing red-team 1/1 ✅ · e2e 11/11 ✅ · build ✅ 267 kB · audit 0 vulnerabilities. The Vercel deployment from `main` completed successfully. Read-only smoke testing of [poke-deal.vercel.app](https://poke-deal.vercel.app/) loaded all six workspaces at 1280 plus Today/List/Setup at 375 with no console errors, failed HTTP responses, or horizontal overflow. Styles were intact; Today columns, the Setup provider disclosure, and List's Stock-to-draft → Listings → Pack builder order matched `output/ui-audit/after/`. No acquire, sale, reset, or publish action was triggered. Production evidence is in `output/playwright/production-smoke/`.

### Mechanical cleanup checkpoint

Work continued from merged `main` on `codex/ui-mechanical-sweep`. Commit [`919da9c`](https://github.com/jamesdocherty97-crypto/poke-deal/commit/919da9cb187e2fec2ca5f0ac77b428834fdc5bb2) completes the four ordered tasks in `CODEX_UI_MECHANICAL_2026-07-18.md`:

1. **Type scale — complete.** 286 target declarations migrated in ten bounded batches (9×30 + 16); zero mapped `px`/`.62rem`–`.72rem` values remain in `components.css`. No constrained-control exception was needed.
2. **Colour tokens — complete with one explicit scope exception.** 69 hard-coded info/yellow/warning/success uses migrated. Brand-token contrast is at least 5.30:1 on the darkest relevant surface set. `.grade-badge.raw { color: #fff4b0; }` remains untouched because grade-badge colours are explicitly out of scope.
3. **Uppercase grammar — complete.** The current file contains 42 uppercase-label rules (the brief's 43 count was stale); all 42 now use `--letter-spacing-label`. No wordmark or grade-badge rule was changed.
4. **Dead rules — complete with one evidence-backed exception.** Removed the 410-line disabled `screens.css` block, the inert component `.secondary-action`, three inert inventory-filter blocks, and two inert grouped selectors. The live top-level inventory-filter block was retained: computed styles showed its gap, padding, and selected background still participate in the cascade, so deleting it would not be a no-op. Stock Task 3→4 image differences were only 0.0192% at 375 and 0.0079% at 1280, confined to the animated refresh glyph/subpixel noise.

Mechanical verification: per-task typecheck + production build ✅ · final typecheck ✅ · unit 865/865 ✅ · overhaul 12/12 ✅ · pricing red-team 1/1 ✅ · e2e 11/11 ✅ · build ✅ 267 kB · audit 0 vulnerabilities · axe-core 4.10.2 12/12 scans clean ✅ · no console errors or horizontal overflow in every 375/1280 capture. The production server was stopped before E2E and the app was rebuilt afterwards.

Screenshot and diff evidence:

- `output/ui-audit/codex-mechanical/task1-batch-{01..10}/`
- `output/ui-audit/codex-mechanical/task2-color-tokens/`
- `output/ui-audit/codex-mechanical/task3-uppercase-grammar/`
- `output/ui-audit/codex-mechanical/task4-dead-rules/`
- `output/ui-audit/codex-mechanical/axe-results.json`

### Mechanical landing and final production closeout

[PR #8](https://github.com/jamesdocherty97-crypto/poke-deal/pull/8) contained exactly the three intended files (`components.css`, `screens.css`, and this handover), was two commits ahead and zero behind `main`, and passed the complete GitHub `required-gates` workflow: dependency audit, Prisma validation/migration against the disposable CI database, unit, overhaul, UX, pricing red-team, typecheck, production build, and Playwright E2E. Its Vercel preview also passed. The PR was made ready only after those gates completed and merged as [`36d9fbf`](https://github.com/jamesdocherty97-crypto/poke-deal/commit/36d9fbfc1f129a8ede268515927fcb524998077e).

The resulting Vercel production deployment completed successfully. A final read-only smoke of all six workspaces at both 375 and 1280 recorded **0 console errors, 0 failed HTTP responses, and 0 horizontal-overflow cases**. Settled screenshots confirmed the Today desktop balance, Stock inventory tabs/cards, List order and controls, and Setup attention-only provider disclosure. The retained Stock-tab rule still computes to its intentional `7px` gap, `2px 1px 4px` padding, yellow selected background, and red selected underline. No acquire, sale, reset, or publish control was used. Final production evidence is in `output/playwright/mechanical-production-smoke/settled/`.

**Codex execution status: complete end to end.** The July audit, Phases 7–10, mechanical Tasks 1–4, both PR landings, CI gates, Vercel deployments, local/preview/production browser verification, accessibility scans, and handover documentation are complete. There is no pending Codex implementation or deployment phase.

**Exact next action:** Fable 5 reviews the landed result and recommends any judgment-led follow-up. Suggested review queue (not incomplete UI-quality delivery): (1) whether a full List queue/listing merge is still worth the complexity after the rename/reorder, (2) deeper Setup row-level disclosure, (3) the today@768 spacing trade-off, (4) `page.tsx` decomposition with `next/dynamic`, and (5) Stock/List virtualization at scale.

### Phase 11 — midnight luxury pass (authored 2026-07-19 by Claude Fable 5; revalidated 2026-07-20)

Owner asked for a premium/sleek dark aesthetic with darker/black backgrounds. Notably, BRAND.md's core
palette table always specified `#080B13` canvas — tokens.css had drifted lighter (`#12172d`); this pass
restores and refines the documented intent.

Changes (CSS-only):

- **tokens.css** — "Midnight vault" surface ladder: canvas `#07090f`, raised `#0b0e18`, surface-1/2/3
  `#0e1220`/`#151a2b`/`#1c2338`, sunken `#050609`. Borders thinned to hairline (.07/.13/.24 alpha),
  scrim deepened, shadows re-tuned for black (`--shadow-1/2`, elevation raised/floating), brand-grid
  gradient darkened, `--brand-ink`/`--color-text-inverse` deepened to `#0a0d16`. Light theme untouched.
- **workbench.css** — frosted command deck: `.dealer-deck.topbar` becomes translucent
  (`color-mix … 62% transparent`) with `backdrop-filter: blur(18px) saturate(1.35)` behind an
  `@supports` guard (solid fallback preserved). Selected inventory filter tab background aligned to
  `--color-danger-surface` (was a clashing yellow tint under red text).
- **base.css** — two fixed sub-5%-alpha radial glows (brand blue top-right, brand red bottom-left)
  behind the canvas gradient for depth without decoration.
- **BRAND.md** — core palette table Dark column updated to the pass values.

Initial verification (2026-07-19): typecheck ✅ · unit 865/865 ✅ · e2e 11/11 ✅ · build ✅ 267 kB ·
axe 12/12 clean (text contrast improved on darker surfaces) · 0 console errors across capture runs.
Screenshots: `output/ui-audit/midnight/{view}-{375,1280}.png`.

Codex revalidation (2026-07-20): typecheck ✅ · `npm test` 910/910 (5 eBay UK benchmark +
3 duplicate-identity + 902 unit) ✅ · UX 15/15 ✅ · overhaul 13/13 ✅ · pricing red-team 1/1 ✅ ·
E2E 14/14 ✅ · production build ✅ 270 kB · `npm audit` 0 vulnerabilities. Today was inspected at
375/768/1280/1920 px and every workspace at 375/1280 px with no horizontal overflow, failed API reads,
or console errors. Keyboard entry exposes the skip link with a visible focus ring.

Checkpoint: the pass is packaged on `codex/midnight-visual-tidy` above `main` @ `2c31064`. Next judgment items unchanged:
page.tsx decomposition; optional polish — hover elevation audit on row cards, sheet/dialog entrance
motion tune, and a pass over remaining hard-coded `rgba(3,8,20,…)` fills if any read muddy on the
darker canvas.
