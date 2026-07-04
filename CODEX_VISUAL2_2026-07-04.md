# Goal: Visual pass 2 — fix what survived, then elevate. Real-rendering verification this time.

**For: Codex 5.5 goal mode. UI-only; zero business-logic/API/schema changes (one exception noted in W1). Gates per phase: npm test, tsc, build, deploy, verify:prod 5/5.**

## Why the last pass missed these (process changes — mandatory)
The prior visual goal verified in Chromium at 390×844 with single-screen screenshots. Bugs survived because (a) Chromium ≠ iOS Safari and (b) overlapping-UI bugs only appear in STACKED states nobody rendered. This goal therefore requires:
- **Playwright in BOTH chromium AND webkit** (webkit ≈ Safari rendering) at 390×844 and 1440×900.
- **A stacked-state matrix**, screenshotted in both engines, before AND after: listing pack open → publish confirm on top; sale sheet with keyboard-height viewport (simulate with a 390×500 viewport); edit sheet over stock list; session dialog over Buy; toast over sheet; decision bar + open dropdown. Commit everything under docs/visual-audit/pass2/.
- Fixes land only with a reproduction screenshot (bug visible) and a resolution screenshot (bug gone) — no "should be fixed now" without pixels.

## Design rulings (decided — these fix bug CLASSES)
**R1 — Never two sheets.** Sheet-on-sheet stacking is banned app-wide; it is the root cause of the publish-confirm overlap. When a flow inside an open sheet needs confirmation, the sheet TRANSITIONS to a confirm step (content swap with slide animation + back affordance) — it does not spawn a second layer. Audit every openSheet/confirm call site and migrate. The listing pack's publish confirmation becomes an in-sheet final step.
**R2 — Slide-to-publish.** Replace the publish confirm button with a slide-to-confirm control (like slide-to-unlock): a track with the eBay price + "slide to publish live". Thumb-friendly, accident-proof, feels premium, and cannot overlap anything because it lives inside the sheet's final step. Use for the two irreversible actions: publish live and delete stock. Plain confirm buttons remain fine elsewhere. (Pointer events; must work with touch and mouse; disabled state while request in flight; snap back on incomplete slide.)
**R3 — Flex hygiene.** "Button stretches off screen" is a flex overflow class bug: audit every horizontal flex row for missing `min-width: 0` on text children, unbounded content pushing fixed siblings, and buttons lacking `flex-shrink`. Fix as a systematic sweep with a written checklist in the commit, not per-instance whack-a-mole.

## Known defects to reproduce and kill (from live phone use, 2026-07-04)
1. Publish-to-eBay confirmation overlapped by other UI (R1 fixes this — verify via the stacked matrix).
2. Publish button sometimes stretches off screen (R3 sweep; find the exact row and screenshot it broken first).
3. Buy page visual bugs (multiple, unspecified): render the Buy page in webkit in every state — empty, suggestions open, comp loading, comp resolved (all 3 confidence states), ambiguous alternatives, deal calc open, session bar present, UK asks block, checked-comps row — and fix every misalignment/overflow/overlap found. Screenshot each state both engines.
4. Audit punch list: additional findings from the live audit will be appended to this goal (or arrive as a follow-up message). Treat each with the same reproduce→fix→prove loop.

## The elevation layer ("look amazing" — implement after the fixes are proven)
**W1 — Card-art ambient headers.** When a comp resolves, use the card's own artwork as a blurred, darkened backdrop behind the receipt header (album-art style: blur ~40px, brightness ~0.45, holo gradient overlay at low opacity; headline price and chips sit on top with AA contrast enforced). The card IS the hero — every comp screen becomes unique. Same treatment on the listing pack header. (Exception to UI-only rule: caching/serving the already-fetched catalog image for this is allowed.)
**W2 — Confidence as rarity.** Express confidence in TCG rarity language everywhere it appears: high = holo shimmer chip, medium = matte silver, low = common grey with dashed border. One component, used in receipt, decision bar, suggestions, stock rows. Instantly readable to a card dealer without reading the label.
**W3 — Slab framing.** Graded items render their grade as a slab-style label plate (PSA-red/CGC-blue/BGS-gold accent by grader, big grade numeral) on stock rows and comp headers. Dealers think in slabs; the UI should too.
**W4 — Decision bar, hero treatment.** Largest type in the app for the headline price (tabular), rarity-chip confidence, offer line beneath, Buy/Watch/Pass as three equal thumb targets with distinct tones. When confidence is high, the bar earns the holo shimmer. Screenshot all states.
**W5 — Depth & elevation system.** Replace remaining flat rgba panels with a consistent 3-level elevation: base / raised card / floating sheet, each with defined shadow + subtle border-light. The app should read as layered physical surfaces (card table → cards → held card).
**W6 — Moment of delight.** Publish success: the listing's own card art flips over (CSS 3D flip) with the Pikachu-spark confetti. Sale imported: coin-flip of the profit figure. Both ≤800ms, non-blocking, skippable by tap.
**W7 — Micro-interactions.** Press-scale 0.98 + brightness bump on primary buttons; suggestion rows slide-highlight; sheet spring (subtle overshoot, 250ms); staggered 30ms fade-in on list rows on first mount only (never on data refresh). Numbers never animate.

## Verification bar to close the goal
- Full stacked-state matrix green in both engines, before/after committed.
- All Buy-page states screenshot-clean in webkit.
- No horizontal scroll anywhere (asserted), tap targets ≥44px, AA contrast maintained over W1 backdrops (check the worst case: white-ish card art).
- verify:prod 5/5. Report: root causes found for defects 1–3, the R3 checklist, and any W-item you deliberately toned down and why.
