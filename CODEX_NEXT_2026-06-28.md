# Codex — Next Build Brief (2026-06-28)

Continuation of the comp/identity review. Two halves:
**Part A** finishes the must-fix gaps from the review (small, high-leverage, do first).
**Part B** adds real card photos from phone/camera roll — the missing dependency that unblocks eBay listing automation end to end.

Author identity for commits: Codex (runs on James's Mac: real `.env`, Neon DB, Vercel, GitHub). Keep the six non-negotiables in `README.md`/`DECISIONS.md`. Add tests in the existing `*.test.ts` style. Ship only when `npm test` + `npx tsc -p tsconfig.check.json` + `npm run build` are green and the deploy is verified live.

---

## Deployment status & discipline (read first)

**Current state, verified 2026-06-28:** the last commit `ad1b82a "Improve comp matching and buy flow"` **is live in production** — `/api/catalog/cards` and the multi-source `/api/system/status` both respond on `poke-deal.vercel.app`, so `origin/main` == deployed. Nothing is currently stranded, and the review session made **no code changes** (it produced this brief only).

This repo has previously stranded work (`fdec242` in the 2026-06-23 handover was committed but never pushed). Don't repeat that. **Every change below ships the same way, and isn't "done" until it's confirmed live on the phone:**

```bash
# on James's Mac, from the repo root
npm test && npx tsc -p tsconfig.check.json && npm run build   # all green or stop
git push origin main                                           # auto-deploys to Vercel
npx prisma migrate deploy                                      # ONLY if schema.prisma changed (e.g. CardPhoto)
# set any new env in the Vercel dashboard too (e.g. BLOB_READ_WRITE_TOKEN) — not just local .env
```
Then **confirm live**, don't trust the build log: hit the changed endpoint on `poke-deal.vercel.app` (or the feature on the phone) before calling it done. A quick `git rev-parse HEAD` vs the deployed commit in the Vercel dashboard catches any "pushed but not deployed" gap.

---

## The outcome we're building toward

At a fair, on the phone, James can do the whole loop without friction:

> **type/scan a card → trustworthy comp (no silent wrong picks) → add to stock → snap front/back/slab → one tap to a real eBay draft/listing with his own photos.**

Everything below serves that one sentence. Part A makes the comp trustworthy and the manual eBay check correct. Part B makes the listing real.

---

# PART A — Finish the comp/identity fixes (do first, ~½–1 day)

These are surgical. They're the difference between "demo-good" and "trust it with cash in hand."

## A1. MUST-FIX — graded eBay link: drop boolean/bracket syntax
**File:** `src/lib/dealer/compLinks.ts`

`gradeBooleanSearchTerm()` currently emits `("ACE 10" OR ACE10)`, `("PSA 10" OR PSA10)`, etc. James asked for plain `PSA 10` / `BGS 9.5` / `CGC 1.5` / `ACE 10`.

- Replace `gradeBooleanSearchTerm(grade)` with a plain spaced label: `gradeLabel(grade)` → `"ACE 10"`, `"CGC 1.5"`. Delete the `(... OR ...)` construction and `compactGradeLabel` usage in that path.
- In `ebaySoldSearchQuery`, the non-RAW branch becomes: if the query already mentions the grade, leave it; else append `gradeLabel(grade)` (spaced, no quotes, no parens).
- Keep `queryMentionsGrade` so explicitly-typed grades aren't double-appended.

**Tests to update** (`compLinks.test.ts`) — these currently *lock in the wrong behaviour*:
- `"adds spaced and compact boolean forms for all slab companies"` → assert plain forms: `ebaySoldSearchQuery("Charizard 151", "PSA_10")` === `"Charizard 151 PSA 10"`, etc.
- `"adds ACE slab grades..."`, `"formats low CGC half grades..."`, `"formats BGS half grades..."`, `"adds slab grade only to eBay sold searches"` → drop the `(...OR...)`, expect e.g. `'... ACE 10'`, `'... CGC 1.5'`, `'... BGS 8.5'`.

## A2. MUST-FIX — space promo codes in the manual eBay query (only there)
**File:** `src/lib/dealer/compLinks.ts` (`normalizeManualCompSearchText`)

The join (`SVP 208` → `SVP208`, `MEP 049` → `MEP049`) is **correct for catalog identity matching** and must stay in `cardSearch.ts` / `normalizeCatalogCardSearchInput` (the `svp`/`mep` catalog rows store `SVP085`). The bug is that the **user-facing eBay `_nkw` query reuses that joined form**. eBay sellers write "Victini SVP 208", so the join hurts recall.

- Decouple: keep identity normalization joined; for the manual search string, emit promo codes **spaced** — `SVP 208`, `MEP 079`.
- Keep genuinely-standard joined codes joined: `TG06`, `TG30`, `GG30`, `SWSHxxx` (these are written joined on eBay). Practical rule: space the dedicated single-card promo prefixes (`SVP`, `MEP`); leave Trainer Gallery (`TG`), Galarian Gallery (`GG`), and `SWSH` black-star joined.
- Simplest implementation: a final `formatPromoForManualSearch()` pass applied to the eBay query *after* normalization that re-inserts the space for `SVP`/`MEP` only (regex `\b(SVP|MEP)0?(\d{1,3})\b` → `$1 $2`, stripped leading zero per eBay norms, e.g. `SVP085` → `SVP 85` or keep `085` — test both against real eBay results and pick the higher-recall form).

**Tests to update** (`compLinks.test.ts`): `"joins modern promo codes for manual eBay searches"` should become a *spacing* test for SVP/MEP and a *join-preserved* test for TG/GG/SWSH.

> Sanity-check the chosen forms against live eBay sold results for 3–4 promos (Victini SVP 208, Pikachu SVP 85, Alakazam MEP 79) before locking the tests — recall is the only metric that matters here.

## A3. KEEP — do not touch the RAW path
`RAW_EBAY_EXCLUSIONS` (`-PSA -BGS -CGC -ACE -SGC -graded`), `LH_PrefLoc=1`, `LH_Sold=1`, `_sop=13`, UK-first ordering — all correct, James confirmed it works. The RAW tests must stay green unchanged.

## A4. MUST-FIX — stop silently picking a card when the search is ambiguous
**Files:** `src/lib/comps/appCompLookup.ts`, `src/app/api/comps/route.ts`, `src/app/page.tsx`

Today, a query like **Umbreon Evolving Skies** with no number resolves to whichever variant the catalog returned first (`resolveCatalogCardUnbounded` → `searched.find(first match)`), and `alternatives` is only surfaced on *recovery* (no catalog / 0 samples). Verified live: `/api/catalog/cards?q=Umbreon&set=Evolving Skies` returns **five** variants (V 94/188/189, VMAX 95/214) — so this is a real, daily hazard, not theoretical.

- In `resolveCatalogCardUnbounded` (or a thin wrapper), when **>1 catalog candidate** satisfies `catalogCardMatchesLookupContext` **and the user gave no disambiguating number**, return an `ambiguous` signal alongside the top candidate (e.g. `{ card, ambiguous: true, candidates }`).
- In `comps/route.ts`, populate `alternatives` (and an `ambiguous: true` flag) whenever resolution was ambiguous — not only on recovery. Still return the best-guess comp so the screen isn't empty, but mark it.
- In `page.tsx`, when `comp.ambiguous`, render the existing **"Possible matches — tap to recheck"** strip *above* the price hero with a one-line "More than one card matches — pick one" so James confirms before trusting the number.

## A5. SHOULD-FIX — lock identity through the comp call
**Files:** `src/app/page.tsx` (`lookupComp`), `src/app/api/comps/route.ts`, `src/lib/comps/request.ts`

Tapping a card in the typeahead doesn't lock identity: `lookupComp` re-resolves from typed `name/set/number`, so the comp can land on a different variant than the one tapped. Pass the selected `tcgApiId` into `/api/comps` and, when present, have `resolveCatalogCard` resolve **by id first** and skip the ambiguous text path entirely. This also makes A4 mostly disappear for the common "I picked it from the list" flow.

## A6. SHOULD-FIX — source-specific empty/limitation messaging
Replace the generic "manual comp required" with the actual reason, surfaced on the comp panel the way `/api/system/status` already phrases it: e.g. *"No eBay sold sample for this grade"*, *"PokeTrace tier has no graded data — use PSA pop + your own sales"*. Map each empty source in `comp.all[]` to a short reason string.

## A7. SHOULD-FIX — turn on the two free Price Tracker signals
**File:** `src/lib/comps/sources/pokemonPriceTracker.ts`
- `trendPct` is hardcoded `null` (lines ~265, ~329). Derive a real % from the history you already request (`days` param).
- The top-level blended `prices` block in the payload is unread — parse it as a second number for the disagreement check.

**Part A acceptance:** the four named hard cases behave correctly on **live** API (not just chase-list fallback): Blastoise XY Evolutions (21/108), Zapdos 192 (151), Victini SVP 208 ACE 10 (spaced + plain grade), Alakazam MEP 079, Lugia Neo Genesis CGC 1.5, and **Umbreon Evolving Skies now prompts to pick**.

---

# PART B — Real card photos → unblock eBay listing automation

## Why this is a hard dependency (not a nice-to-have)
- eBay **will not publish an offer without at least one image** (confirmed against eBay's "Managing images" docs). You cannot list graded singles off catalog stock art — buyers (and eBay) need the actual card/slab.
- eBay image URLs must be **HTTPS and publicly reachable**; eBay either pulls them or you push them to eBay Picture Services. So photos must live somewhere with a public URL **before** the Sell API call.
- Conclusion: the photo pipeline is the prerequisite for the `createOrReplaceInventoryItem → createOffer → publishOffer` chain that's already scaffolded in `src/lib/ebay/`. Build it next.

## The one constraint that dictates the architecture
Vercel serverless functions reject request bodies over **4.5 MB**. Phone photos are 3–12 MB (and iOS often hands you **HEIC**). If you upload *through* an API route, large photos fail intermittently and confusingly. **Solution: client-side compress + upload direct to blob storage** (Vercel Blob `handleUpload`, supports up to 500 MB, secure server-issued token). Never route the raw file through a serverless body.

## Recommended stack (lowest-friction on your existing setup)
- **Storage: Vercel Blob.** Native to your host, public HTTPS URLs out of the box, trivial. Add `BLOB_READ_WRITE_TOKEN` in Vercel env. (R2/S3 are cheaper at scale but overkill now.)
- **Capture: plain web file input**, no native app needed (keeps the PWA simple):
  ```html
  <input type="file" accept="image/*" multiple />        <!-- OS picker: camera OR camera roll -->
  ```
  Omit `capture` so James can choose camera *or* roll. (Add a second "Take photo" button with `capture="environment"` for rear-camera-direct if you want one-tap shooting at the table.)
- **Client processing (do all of this before upload):**
  1. Decode via `createImageBitmap(file, { imageOrientation: 'from-image' })` (auto-rotates EXIF; on iOS Safari, drawing to canvas also decodes HEIC).
  2. Resize to max ~1600px long edge.
  3. Re-encode `canvas.toBlob(..., 'image/jpeg', 0.85)` → **converts HEIC→JPEG, strips EXIF/GPS, and gets each file comfortably under a few hundred KB.** (eBay technically accepts HEIC now, but JPEG is universal, smaller, and avoids edge cases.)
  4. Enforce eBay minimums client-side: **≥500px on the longest side**, ≤ eBay's max; warn if a chosen photo is too small/blurry.

## Data model (Prisma — keep it card-agnostic)
Add a `CardPhoto` table (one-to-many on `InventoryItem`; optionally reusable by `Listing`). Don't store base64 in Postgres.
```prisma
model CardPhoto {
  id              String        @id @default(cuid())
  inventoryItem   InventoryItem @relation(fields: [inventoryItemId], references: [id], onDelete: Cascade)
  inventoryItemId String
  url             String        // public Vercel Blob HTTPS URL
  role            PhotoRole     @default(FRONT)  // FRONT | BACK | SLAB | EXTRA
  width           Int?
  height          Int?
  order           Int           @default(0)
  createdAt       DateTime      @default(now())
  @@index([inventoryItemId])
}
enum PhotoRole { FRONT BACK SLAB EXTRA }
```
Keep **catalog art** (TCG API) and **item photos** (his shots) separate concerns: comp/identity keep using catalog art; **listings must use the real photos**. Migrate with `npx prisma migrate deploy` on production.

## API + flow
1. `POST /api/inventory/[id]/photos/upload-token` → returns a Vercel Blob client token (`handleUpload`'s `onBeforeGenerateToken`, gated by the existing auth middleware). Validate it's James and the item exists.
2. Browser uploads each compressed JPEG **direct to Blob** with that token.
3. `onUploadCompleted` (or a follow-up `POST /api/inventory/[id]/photos`) writes `CardPhoto` rows (url, role, dimensions, order).
4. UI: in the inventory row / item sheet, an "Add photos" control → camera/roll → thumbnails with drag-to-reorder and role tags (front/back/slab). Show upload progress + retry (fair wifi is flaky).

## Wire photos into the eBay Sell API (the payoff)
**Files:** `src/lib/ebay/inventoryItem.ts`, `src/lib/dealer/listingPack.ts`, `src/app/api/listings/[id]/ebay/*`
- Add the item's ordered `CardPhoto.url[]` to `product.imageUrls` in `createOrReplaceInventoryItem`. `buildListingPack()` is already structured for this — feed `imageUrls` through it.
- In `preflight`, **block publish if `imageUrls.length === 0`** with a clear "Add at least one photo" message (mirrors eBay's own rule, fails fast before the API call).
- Publish chain stays: `createOrReplaceInventoryItem` (now with imageUrls) → `createOffer` → `publishOffer`.
- Optional hardening: front photo first; cap at 12; ensure ≥500px (already enforced client-side).

## Photo pipeline acceptance
A photo shot on the phone appears as a thumbnail within seconds, survives reload (DB-backed Blob URL), and a listing **cannot** be published without one. End to end: snap → it's on the eBay draft.

---

# Suggested order (highest leverage first)

| # | Item | Why now | Rough size |
|---|------|---------|-----------|
| 1 | A1 + A2 eBay query fixes | The thing he taps every buy; explicit ask; tiny diff | 2–3 h |
| 2 | A4 + A5 ambiguity guard + identity lock | Stops silent wrong picks — trust with cash | ½ day |
| 3 | B: photo capture + Blob + CardPhoto | Unblocks all real listing | 1–1.5 days |
| 4 | B: eBay Sell API imageUrls wiring + preflight gate | Turns drafts into real listings | ½ day |
| 5 | A6 source-specific empty states | Polish that builds trust | 2–3 h |
| 6 | A7 trend % + blended price | Free accuracy already in payload | 2–3 h |

Do 1–2 in one pass (pure logic + tests, no infra). Then 3–4 together (the photo arc). 5–6 are fast follow. **Push + verify live after each pass — don't batch a week of work into one undeployed branch.**

# Verification before "done"
- `npm test` green incl. rewritten `compLinks.test.ts` and new ambiguity/photo tests.
- `npx tsc -p tsconfig.check.json` + `npm run build` clean.
- Live smoke on phone: the four named hard cards + Umbreon ambiguity; a real photo upload + an eBay draft created with that photo.
- If you added env (`BLOB_READ_WRITE_TOKEN`), set it in Vercel, not just local `.env`. Run `prisma migrate deploy` on prod for `CardPhoto`.
- `git push origin main` and confirm the deployed commit in Vercel matches `git rev-parse HEAD`.

# Don't
- Don't route raw photos through a serverless API body (4.5 MB limit).
- Don't store images as base64 in Postgres.
- Don't let catalog stock art leak into eBay listings — listings use his real photos.
- Don't weaken the auth gate on the upload-token route.
- Don't break fixture mode (app still runs with no keys).
- Don't leave work committed-but-unpushed, or pushed-but-unverified. Live on the phone is the bar.
