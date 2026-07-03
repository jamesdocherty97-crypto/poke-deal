# Goal: Visual overhaul — make Poke Deal genuinely beautiful. Systematize, fix, art-direct, polish.

**For: Codex 5.5 goal mode. VISUAL/UI ONLY — zero business-logic, API, or data changes. Design direction below is decided; execute with ambition. Gates per phase: npm test, tsc, build, deploy, verify:prod 5/5. MANDATORY: Playwright (chromium, 390×844, deviceScaleFactor 3) against local dev — screenshot every screen BEFORE and AFTER each phase; commit pairs under `docs/visual-audit/`. You are not allowed to style blind.**

**Image generation is in scope and encouraged — actual Pokémon.** This is a private, password-protected personal app and the imagery is fan art: generate real Pokémon characters (Pikachu, Snorlax, Psyduck, Gengar, Meowth, Magikarp, etc.), Pokéballs, and type-energy symbols, rendered in one consistent illustration style of your choosing (recommended: soft-shaded sticker/chibi style that sits well on dark UI). HARD RULE: generated art lives in the app UI only — it must NEVER be attached to eBay listings or any outward-facing surface; listing images remain real photos / catalog card scans exclusively (buyer-accuracy).

## Art direction (decided)
**"Premium TCG collector, night-market energy — unmistakably Pokémon."** The feeling of opening a binder of slabs under good light: deep near-black navy base, panels like matte card sleeves, *holographic foil* as the signature accent (iridescent cyan→violet→pink shimmer) on the moments that matter — headline price, decision bar, confidence-high, publish success — and Pokémon characters doing the emotional work throughout (see V3). Brand red/yellow/blue stay as functional accents. Data stays high-contrast and sober — the shine and the creatures frame the numbers, never compete with them. In bad fair lighting the app must still read instantly.

## V0 — Design tokens + hygiene (foundation)
1. Extend `:root` into a real token system and migrate existing rules section by section:
   - Spacing `--space-1..8` (4px scale); type scale `--text-xs..2xl` (size/line-height pairs); `font-variant-numeric: tabular-nums` on all money app-wide; radii `--r-sm/md/lg` (6/10/16); shadows `--shadow-1/2`; semantic `--ok/--warn/--danger`; confidence `--conf-high/--conf-med/--conf-low`; the holo accent as `--holo` (a reusable gradient) + `--holo-subtle`.
   - Z-index scale `--z-nav:100 --z-sheet:200 --z-overlay:300 --z-toast:400` — replace all 14 ad-hoc z-indexes.
2. Dedupe globals.css (7,170 lines; `.confirm-sheet` is defined at BOTH ~5390 and ~6220 — that conflict is the reported half-off-screen publish confirm). Split into logical imported files (tokens/base/components/screens). Report line count before/after.

## V1 — One Sheet system (root-fixes the publish-confirm bug)
One bottom-sheet pattern; migrate EVERY modal/confirm/sheet to it (publish confirm, delete, sale sheet, listing pack, edits, session dialogs): bottom-anchored, max-height 85dvh, internal scroll with pinned header, `padding-bottom: max(16px, env(safe-area-inset-bottom))`, backdrop + body scroll-lock, 200ms transform transition, destructive primary action full-width at the bottom (thumb reach). Playwright-verify the publish confirm fully visible with keyboard open AND closed — screenshot proof.

## V2 — Search & autocomplete (the "letters all over the place" bug)
Reproduce with Playwright first; record the root cause in the commit message. Rebuild suggestions as a proper listbox: full-width under the input, one suggestion per row (thumbnail left, name/set/number in fixed columns), pressed/active states, internal scroll, keyboard-navigable. Same component for card, set, and Quick Fill suggestions.

## V3 — Generated art & identity layer
Generate, optimize (AVIF/WebP, each asset ≤60KB, total added weight ≤500KB — fairs have bad signal), and integrate:
1. **App icon + splash**: a Pokéball cracked open revealing a holo card glow, on deep navy. Regenerate all PWA icon sizes + iOS splash; update manifest + theme-color.
2. **Empty-state illustrations** (one consistent character style, ~6 pieces, each earning its meaning): empty stock — Snorlax asleep on an empty binder ("nothing in stock — go hunting"); no sales yet — Meowth staring at a single coin; no watches — Noctowl perched waiting; no alerts — Chansey relaxing; empty deal session — Machop with an empty cart; no search results — Psyduck holding its head. Small, charming, never loud.
3. **Loading identity**: a proper Pokéball spinner for comp lookups (small SVG, CSS-animated wobble/spin — not a heavy GIF); optionally a tiny Ditto morph for longer loads. Consistent with the skeleton style.
4. **Background texture**: extremely subtle holo-grain/energy texture (barely-there, must not affect text contrast — verify AA after applying).
5. **Celebration moment**: publish-success and sale-imported get a brief (≤800ms, non-blocking) flourish — holo confetti with a tiny Pikachu spark, like pulling a hit.
6. **Nav tabs**: the five tabs get Pokémon-language icons (e.g. Buy = Pokéball, Stock = binder/card stack, List = price tag with energy symbol, Profit = coin/Meowth charm, Today = Pikachu silhouette bolt), one consistent stroke style; active tab gets the holo accent.
REMINDER: none of these assets may ever appear in eBay listing payloads.

## V4 — Screen-by-screen sweep (Playwright before/after per screen)
Today, Buy (input stack, decision bar, receipt, UK asks, deal calc, sessions), Stock (rows, photo tools, edit/sell sheets), Listings (rows, pack, sync panel), Profit (tables), Setup (health, settings):
- Everything on the spacing scale; consistent panel treatment; tap targets ≥44×44; no text overflow; long names ellipsize deliberately; money right-aligned tabular; NO horizontal page scroll anywhere (assert via Playwright).
- Contrast AA for body/chip text (audit --muted #aeb9cf on panels; adjust token if borderline).
- Every button: visible pressed/disabled/loading states. Every list: styled empty state (using V3 illustrations). focus-visible outlines.
- **Decision bar is the hero**: headline price largest (holo accent when confidence high), color-coded confidence chip, offer line secondary, Buy/Watch/Pass unmissable. Screenshot all three states (confident / manual-check / ambiguous).
- Comp receipt: evidence rows get clear visual grammar — sold-based sources vs asks vs catalog visually distinct at a glance (weight/icon, not just labels).

## V5 — Motion & feel
150–200ms ease-out on sheets/dropdowns/toasts; instant (no animation) on data/number updates — numbers that animate feel untrustworthy at a fair. One toast style, bottom-anchored above nav. Subtle press-down scale (0.98) on primary action buttons. Pull-to-refresh and tab switches must feel immediate — if lazy-loaded tabs flash blank, add a 100ms skeleton instead.

## V6 — Verify & ship
Full gates + deploy + verify:prod 5/5. Commit the complete before/after gallery under `docs/visual-audit/` with index.md. Report: V2 root cause, CSS lines before/after, total asset weight added, screens changed, and the top 5 improvements you saw but couldn't make without logic changes.

## Hard prohibitions
- No CSS framework migration; no new runtime deps (Playwright as devDependency ok).
- No logic/route/API/schema changes; no copy rewording beyond casing consistency.
- Generated art NEVER in eBay listing images or any outbound payload.
- Legibility beats decoration on every conflict — if a texture or shimmer costs contrast, the texture loses.
