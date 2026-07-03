# Goal: eBay live — harden listing push, pull UK ask evidence, auto-import own eBay sales

**For: Codex 5.5 goal mode. Self-contained. Context: eBay OAuth is live (Sell API READY in Setup), business policies exist on the seller account (EBAY_UK, Glasgow location), and the dealer is test-publishing one real listing today. Marketplace Insights remains unavailable (closed program) — nothing in this goal depends on it. Standing gates per phase: npm test, tsc check, npm run build, deploy, `npm run verify:prod` 5/5. Reconciler scoring stays frozen; E2 explicitly does NOT add a reconciler candidate source.**

## E1 — Publish-path hardening (do first; the dealer is exercising it live today)
1. Walk the existing readiness → create offer → publish path end to end in code and fix the gaps a first real publish will hit:
   - Merchant location: if `EBAY_MERCHANT_LOCATION_KEY` isn't set or the location doesn't exist on eBay, the readiness check must say so AND offer one-tap creation via the existing /api/ebay/location route using the EBAY_LOCATION_* env vars. Verify those env vars are populated in Vercel (Glasgow address); if any are missing, list exactly which in the report.
   - Policy resolution: the offer must resolve the seller's actual policy IDs (fetch via the policies module) rather than requiring env-configured IDs; if multiple policies exist per type, pick the eBay-default one and say which was used in the confirm overlay.
   - Error surfaces: every eBay API error during create/publish must render its actual eBay error message + errorId in the UI (not a generic failure), and log the full response server-side.
2. If the dealer reports a publish error from today's live test (it will be pasted into the goal chat or a file), fixing that exact error is E1's top priority.
3. After publish succeeds: the listing record must store the live eBay listingId + URL and flip to Active automatically.
4. Test coverage: readiness gaps (no location, no policies), offer payload construction for RAW vs graded (condition mapping, cert in title/specifics), publish error propagation.

## E1b — Photo capture/upload (the dealer hit this immediately: eBay requires images, the app has no upload)
1. Add photo upload to the listing/stock flow: `<input type="file" accept="image/*" capture="environment">` so the phone camera opens directly; multiple photos per item.
2. Store via **Vercel Blob** (@vercel/blob, `BLOB_READ_WRITE_TOKEN` — create the store in the Vercel dashboard if the token env is missing and say so in the report). Client-side downscale to ≤1600px longest edge / ~85% JPEG before upload (fair uploads happen on mobile data). Public HTTPS URLs → stored on the inventory item → passed as the eBay inventory item's imageUrls.
3. Show thumbnails on the stock row/pack sheet; allow delete/reorder (first image = eBay primary).
4. Graded slabs: nudge copy "include a clear cert photo" when gradeBucket ≠ RAW.
5. Manual image-URL entry stays as a fallback field.
6. Tests: upload route (mocked blob), downscale util, imageUrls payload inclusion.

## E2 — UK ask evidence via Browse API (data pulling, available today — asks are NOT solds)
Design ruling: live UK asking prices are a legitimate evidence signal and a UK-relevance win, but asks are systematically above realized prices. They must NEVER enter reconciliation as a candidate or influence the headline. Display + context only.
1. New module using the Buy Browse API (`item_summary/search`, marketplace EBAY_GB, basic api_scope — already granted): query by card name + set + number (+ grade keywords for slabs), fixed-price + auction, sort by price+shipping ascending, take the lowest 5 relevant asks. Filter obvious mismatches by title tokens (number must appear; exclude "proxy", "custom", "damaged" unless condition matches).
2. Comp receipt: new evidence row "UK asks (live): from £X · n listings · lowest 3 shown" with links to the listings. Clearly labelled as asking prices, visually distinct from sold-based rows.
3. Deal context: in the Deal Judge / decision bar area, show "Undercut price: £Y" = lowest relevant UK ask minus one rounding step — useful when the dealer lists the card later. Pure display.
4. Cache per card+grade for 1 hour; per-day call budget guard (reuse the paid-source budget pattern; Browse is free-tier 5,000/day — cap our use at 500/day, log skips).
5. Tests: query construction, title-token filtering, never-in-reconciler (assert the reconciliation input set is unchanged when asks are present).

## E3 — Own-sales auto-import via Fulfillment API (the flywheel; scopes already granted)
When something sells on eBay, the app should know without being told:
1. Sync module using Sell Fulfillment API `getOrders` (filter: creation date since last sync, order status paid). Match line items to app listings by SKU (set SKU = inventory item id on all future offers in E1; for unmatched orders, land them in a "match manually" queue, never guess).
2. On match: auto-create the sale record (channel eBay, actual sale price, actual postage charged; fees = estimate from the deal-calc fee model, flagged "estimated — reconcile with payout" until a later Finances API pass) and decrement/close stock — reuse the existing mark-sold logic, do not fork it.
3. Trigger: piggyback the existing daily cron + a manual "Sync eBay sales" button on the Listings tab. Idempotent by eBay orderId (re-sync must not duplicate sales).
4. Every import lands an alert in the automation inbox ("eBay sale imported: <card> £X").
5. These imported sales feed owned-sales comps automatically (they flow through the same sale records the comp source already reads — verify, don't duplicate).
6. Tests: order→sale mapping, idempotency, unmatched-order queue, stock decrement via existing path.

## E4 — Wrap
USER_GUIDE.md: publish flow (with readiness), UK asks row meaning (asks ≠ solds), auto-import behaviour and the manual-match queue. Report: what E1 fixed, sample UK-asks output for 2 cards, and the first synced order if any exists.

## Out of scope
Marketplace Insights (closed), MIP CSV feeds (separate brief if wanted), Finances API fee reconciliation (later pass), token rotation (dealer does after live validation).
