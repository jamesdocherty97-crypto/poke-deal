# Poke Deal brand system

Status: brand v2 is applied over the stable UX hierarchy; PWA/metadata assets and semantic trust states are wired. Final screenshot evidence and gate results are recorded below. Last updated 2026-07-11 (Europe/London).

## Brand decision and scope

Poke Deal is a private, personal dealer tool. The owner explicitly wants it to feel unmistakably Pokémon and to retain the existing Poké Ball and character artwork. That preference overrides the original outside-pass proposal for a franchise-neutral commercial identity.

The resulting direction is **trading floor × card workshop × Pokémon**: disciplined data, tactile card-handling cues, and familiar character joy at the edges. The system is intentionally not positioned as an official or affiliated product. If the app becomes public, multi-user, sold, or used in public marketing, review the name and all franchise artwork before that change in scope.

The visual pass does not change navigation, information hierarchy, or component layout. It applies the stable token grammar and versioned assets to the completed UX work.

## Baseline visual audit

The original token file had a useful 4px spacing scale, compact type scale, dark surfaces, elevation, z-index, and motion aliases, so those names remain intact. The weaknesses were semantic rather than structural:

- Franchise red/yellow/blue and operational state were coupled (`--warn` and medium confidence both resolved to brand yellow; several components use `--yellow` as both accent and meaning).
- Confidence was three colours only, with no bar count, pattern, surface, or border grammar for colour-blind and monochrome use.
- There were no shared freshness or source-mix tokens, so the no-bare-number evidence contract had no consistent visual vocabulary.
- Dark was the only authored colour scheme. Surfaces and text had no explicit light equivalents.
- Typography and touch sizing had no semantic families; several screens consequently drifted to hard-coded small sizes.
- `--holo` was an effective identity accent but could too easily leak into operational state.

The new layer separates brand, surface, operational, confidence, verdict, freshness, and source roles while keeping every legacy name as an alias. Existing components therefore render without a forced layout/retheme migration, and new UX work can use the semantic API immediately.

## Principles

1. **Decision first.** Price, verdict, confidence, sample size, and freshness stay legible under poor light and at arm's length.
2. **Evidence stays visible.** Pokémon personality may frame a receipt; it must never obscure uncertainty, source disagreement, stale data, or a manual-check reason.
3. **Character joy lives at the edges.** Characters belong in empty states, onboarding, loading rewards, and celebrations. Dense tables and live decision controls remain quiet.
4. **Colour is reinforcement, not the message.** Confidence, verdicts, freshness, and source state always combine colour with text, icon shape, border/pattern, or bar count.
5. **Dark mode is authored.** The primary dark palette is designed for a dim card hall. Light mode is a separately tuned palette, not a mechanical inversion.

## Identity

### Name and wordmark

Use the name as **POKE DEAL** in UI chrome and artwork. The compact wordmark treatment is:

- `POKE` in white and `DEAL` in electric yellow on dark surfaces.
- Bold, slightly condensed, forward-moving sans serif; uppercase only for the actual wordmark.
- Tracking stays tight (`-0.02em` to `-0.035em`). Never imitate the Pokémon logotype lettering.
- Optional descriptor `DEALER OS` may sit below in small uppercase data type with generous tracking. It is not part of the formal name.
- In prose and accessible names, write `Poke Deal`.

### App mark: “caught comp”

The v2 mark combines a classic Poké Ball, a bold price-tick/check, and a small receipt-edge notch. The ball supplies the requested franchise recognition; the tick says “decision made”; the notch connects it to the trusted comp receipt.

- Keep the complete mark inside the central 72% of maskable artwork.
- Minimum useful raster size: 32px. Below 32px, use the favicon derivative rather than scaling a page illustration.
- Clear space: at least the width of the centre button around the mark.
- Do not rotate, recolour by verdict, put type inside it, or animate the whole mark continuously.
- The mark is identity only. A check inside the logo must not be reused as the sole icon for Buy.

## Token architecture

The source of truth is [`src/app/styles/tokens.css`](src/app/styles/tokens.css). New work uses semantic tokens; the old short names remain compatibility aliases during the component migration.

### Naming layers

| Layer | Examples | Rule |
| --- | --- | --- |
| Raw brand | `--brand-red`, `--brand-yellow`, `--brand-blue`, `--brand-sky` | Identity and decoration only; never infer operational meaning from a brand colour. |
| Surface/text | `--color-canvas`, `--color-surface-1`, `--color-text-primary`, `--color-border` | Default component building blocks. |
| Operational state | `--color-success`, `--color-warning`, `--color-danger`, `--color-info` | Generic feedback, not dealer verdicts. |
| Confidence | `--confidence-{high|medium|low}-{color|surface|border|pattern}` | Every reconciled price and receipt. |
| Verdict | `--verdict-{buy|watch|pass}-{color|surface|border}` | Deal Judge actions and outcomes only. |
| Freshness | `--freshness-{live|recent|aging|stale|expired}-{color|opacity}` | Evidence age and cached-state treatment. |
| Source mix | `--source-{owned|checked|sold|market|cached}-color` | Segments in the receipt source glyph. |
| Structure | `--space-*`, `--radius-*`, `--font-*`, `--duration-*`, `--ease-*` | Layout and interaction primitives. |
| Compatibility | `--bg`, `--panel`, `--ink`, `--yellow`, `--conf-med`, `--holo`, and peers | Existing CSS only. Do not introduce these in new components. |

### Core palette

| Role | Dark | Light | Token / rule |
| --- | --- | --- | --- |
| Canvas | `#080B13` | `#F3F6FA` | `--color-canvas` |
| Raised canvas | `#0D1424` | `#FFFFFF` | `--color-canvas-raised` |
| Primary ink | `#F8FBFF` | `#111827` | `--color-text-primary` |
| Secondary ink | `#B8C3D7` | `#455166` | `--color-text-secondary` |
| Brand red | `#EF3340` | same | Decoration and large marks; use semantic danger for text. |
| Brand yellow | `#FFCB05` | same | Primary identity accent; pair with `#111827`, not white. |
| Brand blue | `#2A75BB` | same | Identity blocks and large graphics; light blue text uses `--color-info`. |
| Holo accent | cyan → violet → pink → yellow | same | `--brand-holo-gradient`; celebratory/identity use only. |

Measured contrast for semantic foregrounds is at least 6.83:1 on dark raised surfaces and at least 5.32:1 on white in light mode. Primary/secondary body ink measures 18.95:1 and 11.08:1 against the dark canvas. Brand red with white is only 3.88:1, so that pairing is reserved for large logo artwork, never small copy.

### Confidence grammar

Confidence is independent of the dealer verdict. A high-confidence Pass and a low-confidence Buy are both valid states.

| Tier | Visual | Colour | Pattern | Accessible label |
| --- | --- | --- | --- | --- |
| High | `▮▮▮` three filled evidence bars | cyan `--confidence-high-color` | solid | `High confidence` |
| Medium | `▮▮□` two filled bars | warm yellow `--confidence-medium-color` | diagonal hatch | `Medium confidence` |
| Low | `▮□□` one filled bar | pink `--confidence-low-color` | dotted | `Low confidence — check manually` |

Rules:

- Never show a confidence dot without the tier word in the same component or an accessible name.
- A price line always keeps sample size and freshness nearby. The compact contract is `£X · n=Y · 12d · High`.
- Pattern is for larger chips/receipt edges; bar count is the compact/table fallback.
- Low confidence cannot be styled as a disabled state. It is a warning to inspect, not missing data.

### Deal Judge grammar

| Outcome | Token family | Required icon/shape | Copy rule |
| --- | --- | --- | --- |
| Buy | `--verdict-buy-*` | tick in a filled square | Button and result say `Buy`; target price remains the dominant number. |
| Watch | `--verdict-watch-*` | eye in a split ring | Always say `Watch`; do not rely on amber alone. |
| Pass | `--verdict-pass-*` | minus in an outlined circle | Always say `Pass`; reserve destructive `×` for delete/cancel actions. |

Buy/Watch/Pass must never be encoded only as green/amber/red. Their labels and three different silhouettes remain visible in monochrome and common colour-vision deficiencies.

### Freshness grammar

Freshness has two clocks: **evidence age** and **cache age**. Do not merge them. A freshly fetched source can still contain old sold evidence; a cached response can contain recent evidence.

| State | Treatment | Evidence guidance |
| --- | --- | --- |
| Live | solid clock, 100% opacity | Fresh live/owned signal. |
| Recent | clock with one tick, 90% | Evidence within the preferred decision window. |
| Aging | half clock, 76%, soft hatch | Evidence is decaying but still usable. |
| Stale | outlined clock, 62%, dashed border, visible `Stale` word | Stale fallback or evidence beyond the preferred window. |
| Expired | crossed clock, 48%, neutral treatment | Outside decision use; do not silently feed the headline. |

Domain logic owns exact thresholds. When only comp age is available, the visual defaults should mirror the reconciler's existing 30/90/180-day boundaries: recent through 30 days, aging at 31–90, stale at 91–180, and expired beyond 180. Always print an actual age or as-of time; the icon is not a substitute.

### Source-mix grammar

The comp receipt uses a fixed five-segment glyph. Segments stay in the same order so the shape is learnable:

1. **Owned** — diamond, `--source-owned-color`.
2. **Checked** — square, `--source-checked-color`.
3. **Sold** — vertical bar, `--source-sold-color`.
4. **Market** — ring, `--source-market-color`.
5. **Cached/fallback** — dash, `--source-cached-color`.

A reporting source fills its segment. A pending source pulses its outline once per reporting cycle. An unavailable source remains visible with a diagonal slash; it does not disappear and imply unanimity. Every glyph gets a plain-language tooltip/popover such as `3 sources: owned sales, checked comps, market aggregate · 1 cached`.

### Fan-out loading

Use the same source glyph for loading. Sources light up as they report; the headline skeleton may resolve at quorum while slower segments remain outlined. Failed sources slash in place. Motion is opacity/colour over `--duration-standard`, not spinning. Under `prefers-reduced-motion`, token durations collapse to 1ms.

### Typography

| Use | Token | Notes |
| --- | --- | --- |
| Primary UI | `--font-ui` | Avenir/system sans; calm, readable, tabular numbers enabled at the body. |
| Wordmark/display | `--font-display` | Rounded/system display voice; bold, tight tracking. |
| Receipts/data | `--font-data` | Monospace only for aligned figures, source IDs, timestamps, and receipt metadata. |
| Micro | `--font-size-micro` (12px) | Exceptional metadata only; never an action or a sole uncertainty label. |
| Label | `--font-size-label` (13px) | Uppercase labels and compact chips. |
| Small body | `--font-size-body-sm` (14px) | Default secondary copy floor. |
| Body | `--font-size-body` (15px) | Dense operational copy. |
| Body large | `--font-size-body-lg` (16px) | Forms and critical explanatory copy. |
| Display | `--font-size-display` (28–40px) | Target buy price and hero metrics. |

Use tabular numerals for all money, sample sizes, ages, and chart axes. Do not set an entire paragraph in monospace.

### Spacing, radius, elevation, and touch

- Spacing uses a 4px base from `--space-1` through `--space-12`.
- Routine touch targets are at least `--touch-target-min` (44px); primary deal actions use `--touch-target-primary` (52px).
- Controls use `--radius-sm` (6px), cards use `--radius-md` (10px), sheets/hero panels use `--radius-lg` (16px). Pills are reserved for status and filters.
- Borders carry most grouping. `--shadow-1` is for raised cards; `--shadow-2` is for sheets and overlays. Do not stack a heavy shadow and a holo glow.

### Motion

- Press feedback: translate no more than 1px and `--press-scale` (`0.98`).
- Source arrival/status: `--duration-fast` or `--duration-standard` with `--ease-out`.
- Sheets: `--motion-sheet`; no spring bounce during dealer workflows.
- Celebration may use one short holo sweep after a completed buy/sale. It must not loop.
- Reduced-motion mode disables meaningful duration and press scaling through the token layer.

### Dark and light rules

- Dark is the default (`:root`) and uses warm white ink on layered navy.
- Light is explicit (`[data-theme="light"]`) and uses darkened semantic foregrounds rather than the dark-mode neons.
- Use semantic surface/text tokens so a component changes theme without selectors inside the component.
- Brand art can keep its red/yellow/blue palette in both modes, but needs a subtle navy keyline on light surfaces.
- Charts keep the same series identity across themes; only grid, label, and fill opacity change.

## Component recipes for the later visual pass

These are visual-expression rules only; UX owns placement and hierarchy.

### Comp receipt

- Paper/receipt edge may use a subtle perforation or notch, never a full novelty ticket texture behind dense text.
- Header: source-mix glyph, as-of time, and confidence bars.
- Headline money uses display type and tabular numerals.
- Sample/range/trend/freshness stay in one evidence strip directly below.
- Manual-check reasons use the low-confidence pattern and remain fully readable; Pokémon character art must not occupy this panel.
- Screenshot mode may add the wordmark/mark in a quiet footer, not over evidence.

### Grade ladder

RAW → PSA → BGS → CGC is a horizontal rail on wide screens and a snap row on phones. Each grade is a neutral slab card with the provider abbreviation, grade, value, delta, sample size, and freshness. The selected grade gets a brand-blue keyline; value gain/loss uses semantic state and an arrow, not brand red/green alone.

### Empty states and onboarding

- Existing character stickers remain the primary character-led surfaces.
- Generated workshop vignettes support onboarding/manual-review flows and use the optimised 512px WebP derivatives.
- Maximum one illustration per viewport. It remains decorative (`alt=""`) when adjacent text fully names the state.
- Character/illustration art should be lazy-loaded and displayed at 220–280 CSS pixels. Never load a 1254px master into the routine UI.

## Existing asset audit

The original outside pass identified the current artwork as franchise trade dress. The owner has explicitly chosen to keep and amplify it. No existing franchise file is deleted or overwritten in this phase.

### Identity and launch assets

| Path | Size | Audit | Direction |
| --- | ---: | --- | --- |
| `public/icon.svg` | vector 512 viewBox | Poké Ball plus holo tick; strongly franchise-coded. | Preserve until the v2 icon is wired after layout stabilization. |
| `public/icon-192.png` | 192×192 | Simple Poké Ball app icon. | Preserve as current production fallback. |
| `public/icon-512.png` / `.jpg` | 512×512 | Simple Poké Ball app icon; duplicate formats. | Preserve; replace manifest references only during the wiring pass. |
| `public/apple-touch-icon.png` | 180×180 | Poké Ball touch icon. | Preserve until v2 wiring. |
| `public/splash.svg` | 390×844 | Poké Ball/tick on holo-dark field. | Preserve; create device-specific replacements only if install testing proves useful. |

### Character-led surfaces to retain

| Path | Character | Current role | Size / weight |
| --- | --- | --- | ---: |
| `public/visual/empty/stock.png` | Snorlax | Stock/default workspace and empty state | 220×220 / 35KB |
| `public/visual/empty/sales.png` | Meowth | Sales/listing empty state | 220×220 / 33KB |
| `public/visual/empty/search.png` | Psyduck | Search/no-match empty state | 220×220 / 27KB |
| `public/visual/empty/session.png` | Machop | Deal-session empty state | 220×220 / 25KB |
| `public/visual/empty/watches.png` | Noctowl | Watch/reprice empty state | 220×220 / 24KB |
| `public/visual/empty/alerts.png` | Chansey | Alerts/health empty state | 220×220 / 30KB |
| `public/visual/celebration/pikachu.png` | Pikachu | Success celebration | compact / 19KB |

These assets already form a lightweight character set (19–35KB each). Reuse them instead of generating a second full character library. The root/UX application pass should retain at least one clearly character-led surface, ideally the empty states plus the existing Pikachu celebration.

## Generated and produced asset inventory

All new project-bound assets are versioned under `public/brand/v2/`. Delivery derivatives are wired; source masters remain unwired archival inputs.

### Masters and delivery assets

| Path | Dimensions / format | Intended use | Provenance |
| --- | --- | --- | --- |
| `app-mark-master-v1.png` | 1254×1254 PNG, 1.0MB | Source master; do not load in routine UI. | Built-in image generation, `BR-PROMPT-01`. |
| `app-icon-512-v1.png` | 512×512 PNG, 262KB | Wired PWA `any` icon. | `BR-PROMPT-01`, resized with macOS `sips`. |
| `app-icon-maskable-512-v1.png` | 512×512 PNG, 262KB | Wired PWA maskable icon; important art remains inside the central safe area. | Same master; versioned separately for manifest wiring. |
| `app-icon-192-v1.png` | 192×192 PNG, 39KB | Wired PWA `any` icon and compact in-app fallback mark. | Same master, `sips`. |
| `apple-touch-icon-180-v1.png` | 180×180 PNG, 34KB | Wired Apple touch icon. | Same master, `sips`. |
| `favicon-32-v1.png` | 32×32 PNG, 2KB | Wired modern favicon. | Same master, `sips`; visually inspected at native size. |
| `favicon-v1.ico` | 16/32/48 multi-size ICO, 7KB | Wired legacy/browser favicon. | Same master, Pillow 11.3.0. |
| `og-share-v1.png` | 1733×908 PNG, 1.3MB | Source master for share artwork. | Built-in image generation, `BR-PROMPT-05`. |
| `og-share-1200x630-v1.jpg` | 1200×630 progressive JPEG, 87KB | Wired Open Graph/Twitter delivery image. | `BR-PROMPT-05`, Pillow resize/optimise. |
| `onboarding-scan-v1.png` | 1254×1254 alpha PNG, 954KB | Source master for scan/source fan-out onboarding. | Built-in image generation, `BR-PROMPT-02`; chroma removed locally. |
| `onboarding-scan-512-v1.webp` | 512×512 alpha WebP, 44KB | Wired progressive-lookup illustration. | Same master, Pillow 86-quality WebP. |
| `manual-check-v1.png` | 1254×1254 alpha PNG, 1.1MB | Source master for manual-review empty state. | Built-in image generation, `BR-PROMPT-03`; chroma removed locally. |
| `manual-check-512-v1.webp` | 512×512 alpha WebP, 47KB | Wired manual-review illustration. | Same master, Pillow 86-quality WebP. |
| `onboarding-bundle-v1.png` | 1254×1254 alpha PNG, 1.2MB | Source master for bundle/deal-session onboarding. | Built-in image generation, `BR-PROMPT-04`; chroma removed locally. |
| `onboarding-bundle-512-v1.webp` | 512×512 alpha WebP, 49KB | Wired offline/device-queue illustration. | Same master, Pillow 86-quality WebP. |

### Processing and inspection record

- Raster generation used the built-in `image_gen` tool. No CLI/API fallback was used.
- Transparent illustration sources were generated on flat green, then processed with the installed `remove_chroma_key.py` helper using `--auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill`.
- Detected keys were `#04F712`, `#03F904`, and `#0AEC0F`. Each final PNG is RGBA with four fully transparent corners.
- Alpha validation: scan `1,066,013` transparent / `6,214` partial pixels; manual-check `929,438` / `6,151`; bundle `884,377` / `4,404`.
- All masters and delivery derivatives were visually inspected. No visible green fringe, clipped subject, incorrect wordmark, or added watermark was found.
- The delivery WebPs are 44–49KB, similar to the existing 19–35KB character stickers. Load delivery derivatives only; masters are archival sources.
- One direct character-led scan-generation attempt was blocked by the image service at output moderation. It produced no file. The existing Pikachu/Snorlax/Meowth/Psyduck/Machop/Noctowl/Chansey assets provide the character layer instead.

## Final prompt set and tool provenance

The prompts below are the successful built-in image-generation prompts. They are recorded verbatim enough to reproduce the direction; local paths and resize operations are documented above.

### BR-PROMPT-01 — app mark

```text
Use case: logo-brand
Asset type: square master artwork for the app icon of a private personal Pokémon-card dealer PWA
Primary request: create a professional app mark that fuses an unmistakable classic red-and-white Poké Ball with a precise dealer price-tick and a tiny receipt-edge notch; it should feel like a trading-floor instrument made for a card workshop
Style/medium: flat vector-like icon artwork, crisp geometric construction, restrained premium finish
Composition/framing: one centred emblem filling about 72% of a square canvas, generous maskable safe area, dark navy rounded-square background
Color palette: deep navy, clean white, franchise red, electric yellow, medium blue, with one restrained holographic cyan-to-violet glint
Lighting/mood: high-contrast, confident, readable at 32 pixels
Constraints: the Poké Ball motif is intentionally permitted for this private personal app; no character; no words; no letters; no numbers; no watermark; no mockup; no extra badges; no tiny detail; perfectly centred and symmetrical overall
```

### BR-PROMPT-02 — scan/source onboarding

```text
Use case: stylized-concept
Asset type: reusable onboarding and empty-state bitmap for a private personal Pokémon-card dealer PWA
Primary request: a cheerful card-workshop vignette showing a smartphone scanning one generic sleeved trading card, with a classic red-and-white Poké Ball resting beside the phone and three small coloured source lights suggesting multiple price feeds
Style/medium: polished cel-shaded sticker illustration, thick clean dark-navy outline, simple readable shapes, premium mobile app empty-state art
Composition/framing: centred compact still life, every object fully visible, generous padding, no crop
Color palette: navy, yellow, red, white, cyan, blue and pink; do not use green in any object
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local background removal
Constraints: the background must be one uniform #00ff00 with no shadows, gradients, texture, reflections, floor plane, glow, or lighting variation; crisp separated silhouette; no cast shadow; no contact shadow; no text; no numbers; no brand wordmarks; no character; no watermark
```

### BR-PROMPT-03 — manual check

```text
Use case: stylized-concept
Asset type: reusable manual-check empty-state bitmap for a private personal Pokémon-card dealer PWA
Primary request: a compact evidence-review vignette with a magnifying glass over one sleeved Pokémon trading card, three small receipt slips fanned behind it, a classic red-and-white Poké Ball paperweight, and three distinct source tokens shaped as a diamond, square and ring
Style/medium: polished cel-shaded sticker illustration, thick clean dark-navy outline, simple readable shapes, premium mobile app empty-state art; match the same visual family as a phone-scanning card-workshop vignette
Composition/framing: centred compact still life, every object fully visible, generous padding, no crop
Color palette: navy, yellow, red, white, cyan, blue, violet and pink; do not use green in any object
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local background removal
Constraints: the background must be one uniform #00ff00 with no shadows, gradients, texture, reflections, floor plane, glow, or lighting variation; crisp separated silhouette; no cast shadow; no contact shadow; no readable text; no numbers; no brand wordmarks; no character; no watermark
```

### BR-PROMPT-04 — bundle onboarding

```text
Use case: stylized-concept
Asset type: reusable deal-session onboarding bitmap for a private personal Pokémon-card dealer PWA
Primary request: a compact card-fair checkout vignette with a small dealer till, a neat stack of sleeved Pokémon cards, coin stacks, one receipt strip curling from the till, and a classic red-and-white Poké Ball beside the bundle; the arrangement should communicate quick bundle maths and a completed buy
Style/medium: polished cel-shaded sticker illustration, thick clean dark-navy outline, simple readable shapes, premium mobile app empty-state art; match the same visual family as phone-scanning and evidence-review card-workshop vignettes
Composition/framing: centred compact still life, every object fully visible, generous padding, no crop
Color palette: navy, yellow, red, white, cyan, blue, violet and pink; do not use green in any object
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local background removal
Constraints: the background must be one uniform #00ff00 with no shadows, gradients, texture, reflections, floor plane, glow, or lighting variation; crisp separated silhouette; no cast shadow; no contact shadow; no readable text; no numbers; no currency symbols; no brand wordmarks; no character; no watermark
```

### BR-PROMPT-05 — Open Graph art

```text
Use case: ads-marketing
Asset type: 1.91:1 landscape Open Graph share image for a private personal Pokémon-card dealer PWA
Primary request: a polished dark trading-floor card showing a classic red-and-white Poké Ball fused with a bold blue price-tick/checkmark, paired with the exact wordmark "POKE DEAL" and a compact dealer-workshop data grid
Scene/backdrop: deep navy field with a subtle 28-pixel technical grid, restrained cyan and violet holographic glints, clean negative space
Style/medium: crisp vector-like product branding, premium professional mobile software, not a mockup
Composition/framing: wide 1.91:1 landscape composition; emblem on one side, large wordmark on the other, generous safe margins
Color palette: navy, white, franchise red, electric yellow, medium blue, cyan and restrained violet
Text (verbatim): "POKE DEAL"
Constraints: render the wordmark exactly once and spell it P-O-K-E space D-E-A-L; no tagline; no extra text; no characters; no watermark; no tiny detail; strong contrast and readable as a social preview
```

## Final visual QA

The stable UX is wired to the v2 tokens, icons, metadata, character art, and semantic trust grammar. Final dark-theme evidence was captured from the production build at 390×844 for [Today](docs/overhaul/final/mobile-today-390x844.png), [Buy](docs/overhaul/final/mobile-buy-390x844.png), [Stock](docs/overhaul/final/mobile-stock-390x844.png), [List](docs/overhaul/final/mobile-list-390x844.png), and [Profit](docs/overhaul/final/mobile-profit-390x844.png), plus [Today at 1440×900](docs/overhaul/final/desktop-today-1440x900.png).

- Pixel inspection found no clipped headings, overlapping controls, broken content, or bottom-navigation collisions. Stock's partially visible final filter is the intended horizontal-scroll affordance.
- Pokémon identity is consistently visible through the card-derived app mark, `POKE DEAL` chrome, yellow/blue/red accents, card thumbnails, and the Pikachu quest illustration without obscuring evidence or actions.
- Light-theme checks on Today and the data-dense Stock view exposed low-contrast hard-coded dark surfaces. The final CSS adds explicit light inputs, filters, sticky section headings, and Today-hero copy/actions; both views were re-rendered and visually rechecked against the rebuilt production bundle.
- Reduced-motion emulation resolves animation and transition duration to `0.001s` and `--press-scale` to `1`, with the layout unchanged. Semantic state labels, shapes, and patterns remain available independently of colour; a separate forced-colours screenshot was not part of this pass.
