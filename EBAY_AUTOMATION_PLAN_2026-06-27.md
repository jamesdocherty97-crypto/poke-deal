# Real Photos → Fully Automated eBay Listing — Plan (2026-06-27)

Goal: the app's own pipeline (Create offer → Publish) creates a genuine, live, editable
eBay.co.uk listing with no manual eBay UI steps, starting with the Dudunsparce ex.

## Two independent tracks — both required

Confirmed this session: there are **two separate locks**, not one. Photos fix one of
them. Only James can clear the other, directly with eBay.

| | Track A — eBay account-side | Track B — App engineering |
|---|---|---|
| Blocker | "Incomplete account information" / `sellerRegistrationCompleted: false` — proven via a live API publish attempt with a working token | App has no real-photo storage; offer pipeline currently sends `Card.imageUrl` (shared catalog/stock photo), which eBay's UI already rejected for this category/condition |
| Who clears it | James, with eBay (registration/payout setup) | Claude (code), with two small Vercel-dashboard steps for James |
| Can code fix it? | No | Yes |

Both must be done before an automated publish will go live. Fixing only one will still fail.

## Track A — eBay account-side (James)

1. Take real photos of the physical card (see step 0 below).
2. Re-run the native "List an item" wizard with those photos so it gets past the
   stock-photo block we hit last time, and see exactly what eBay surfaces next —
   that's the fastest way to find the actual registration/payout requirement.
3. Complete whatever eBay asks for (identity/payout verification). I will navigate
   and read pages for you, but per my own rules I won't enter bank details,
   passwords, or complete identity verification on your behalf — that part is yours.
4. Confirm via `/api/ebay/status` and a real publish attempt that the gate is gone.

## Track B — App engineering (Claude)

**Step 0 (do this first, unblocks everything): James takes 2–3 real photos of the
actual Dudunsparce ex** — front, back, any flaw — and drops them in the workspace
folder or uploads them here.

1. **Prisma migration** — add real-photo storage to `InventoryItem` (e.g.
   `photoUrls String[]`), distinct from the shared `Card.imageUrl` catalog photo.
2. **Vercel Blob** — add `@vercel/blob`; create + link a Blob store in the Vercel
   dashboard. Gives uploaded photos a public URL on `*.public.blob.vercel-storage.com`
   — outside the app's own Basic-Auth middleware (`src/middleware.ts` gates every
   route on this domain, so self-hosted images would 401 when eBay's servers try to
   fetch them; Blob's separate domain sidesteps that entirely).
3. **Upload API route** — `POST /api/inventory/[id]/photos`, stores the file via
   Blob's `put()`, saves the public URL onto the new field.
4. **Upload UI** — file input with mobile camera capture
   (`<input type="file" accept="image/*" capture="environment">`) on the
   inventory/listing pack screen, thumbnail preview, delete.
5. **Wire into the offer pipeline** — `preflight.ts` / `offer/route.ts` use the
   real per-unit photo instead of `listing.item.card.imageUrl`; block ungraded-card
   offer creation if no real photo is attached yet (fail fast, matching eBay's own
   rule, instead of failing late at publish).
6. **Test, commit, deploy** — extend the existing `ebay.test.ts`-style tests, run
   `npm test` + typecheck, push to `main` (Vercel auto-deploys).
7. **End-to-end verification** — once Track A is clear and a real photo is
   uploaded, run the app's own automated create-offer + publish flow and confirm a
   live, editable listing on ebay.co.uk with the real photo.

eBay API note: the Inventory API's `product.imageUrls` just needs any publicly
fetchable HTTPS URL — it does not itself enforce the "no stock photos" rule (that's
a web-listing-tool UI guardrail). Real photos are still the right move regardless,
both for buyer trust and because eBay can act on stock-photo misuse after the fact
even via API-created listings.

## Optional roadmap extension — photo → auto comps (stretch, not a blocker)

James asked whether photos could also be auto-scanned to pull comps as part of the
same flow. Feasible, but it's a different part of the workflow than what's blocking
automated listing today — comps already run automatically the instant a `Card` is
identified (today that's via the existing text/fuzzy catalog search). What photo
scanning would add is automating *that identification step* itself:

- Use a vision-capable model to read name/set/number off the photo.
- Feed the result through the existing fuzzy catalog matcher
  (`src/lib/catalog/fuzzy.ts`, `cardSearch.ts`) to resolve a real `Card` row.
- Let the existing `CompService` run as normal — no changes needed there.
- Needs a new vision API key (e.g. Anthropic) added to `.env`/Vercel — not present
  today.
- Out of scope on purpose: auto-grading condition (whitening/edgewear/centering)
  from a photo. Too unreliable to automate safely — condition stays human-judged.
- This mirrors the "Scan-a-card" stretch goal already on file in
  `CODEX_BACKLOG.md` (#15). Recommend building it *after* the core 7 steps above
  are proven end-to-end, not in parallel — it's an intake-speed nice-to-have, not a
  dependency of automated publishing.

## Sequencing

Track A and Track B can run in parallel — neither blocks the other from starting.
Final success requires both done. Fastest path: James takes photos now (Step 0),
which simultaneously unblocks Track A's next probe and lets Claude start Track B
step 1 immediately.
