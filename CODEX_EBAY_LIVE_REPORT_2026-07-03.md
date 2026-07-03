# CODEX_EBAY_LIVE Report - 2026-07-03

## Result

E1, E1b, E2 and E3 are implemented, committed, pushed, deployed to production and verified.

Live site:

- https://poke-deal.vercel.app

Production verifier after E3:

- 5/5 cards passed.

Latest production deployment:

- E3 deployment id: `dpl_D39x8YbLaNtT7JLWs5xCvCC23Rpz`
- Aliased to: `https://poke-deal.vercel.app`

## E1 - Publish-path hardening

What changed:

- eBay readiness now distinguishes configuration, connection, policies, merchant location, photos, price and already-published state.
- Offer creation resolves the seller's actual eBay policies instead of relying on hard-coded policy env ids.
- Merchant-location readiness can surface missing location setup and offers one-tap creation through `/api/ebay/location`.
- Create-offer and publish failures surface the real eBay error message/error id where available.
- Successful publish stores the live eBay listing id and URL, flips the listing Active and moves stock to Listed.
- Trading API fallback remains available for seller-registration/Sell API edge cases.

Production location env fields still not present in Vercel at E1 check time:

- `EBAY_MERCHANT_LOCATION_KEY`
- `EBAY_LOCATION_ADDRESS_LINE1`
- `EBAY_LOCATION_CITY`
- `EBAY_LOCATION_POSTAL_CODE`
- `EBAY_LOCATION_COUNTRY`

The app can still create a location from the UI when address details are entered, but adding these env vars later makes the one-tap path cleaner.

## E1b - Real photo capture/upload

What changed:

- Stock/listing rows can capture photos from the phone camera or upload images.
- Photos are client-compressed to mobile-friendly JPEG before upload.
- Photos are stored as public Vercel Blob URLs and saved on the inventory item.
- First photo is treated as the primary eBay image.
- Photos can be reordered/deleted.
- Graded cards nudge the user to include a clear cert photo.
- Manual public image URL fallback remains.
- eBay inventory payloads include the stored image URLs.

## E2 - UK ask evidence

What changed:

- Added eBay Browse API ask evidence as display-only context.
- It queries eBay GB in the Pokemon card category.
- It filters obvious mismatches such as proxies, custom items, binder inserts, mystery/chance packs and graded leakage for RAW searches.
- It shows lowest relevant asking prices and an undercut price.
- It does not enter reconciliation and does not change the headline comp.
- It is cached for 1 hour and guarded by a daily app budget.

Live samples from production:

| Card | Ask count | Lowest ask | Undercut | First returned title |
| --- | ---: | ---: | ---: | --- |
| Umbreon VMAX 215/203 RAW | 5 | £978.40 | £977.40 | 2021 POKEMON SWORD & SHIELD EVOLVING SKIES 215/203 UMBREON VMAX SECRET RARE |
| Zapdos ex 151 192/165 RAW | 5 | £14.99 | £14.49 | Pokémon TCG - Zapdos ex 192/165 - Scarlet & Violet 151 - Ultra Rare |

Victini SVP 208 currently returns zero filtered UK asks from Browse for this exact query, while the sold-comp headline still resolves through PokeTrace. That is acceptable: empty ask evidence should mean "no clean active UK ask found", not a comp failure.

## E3 - Own eBay sales import

What changed:

- Added `EbayOrderImport` ledger table for idempotent order imports and unmatched-order queueing.
- Added Sell Fulfillment API order-sync module.
- Added `/api/ebay/orders/sync`:
  - `GET` reads recent import/unmatched queue.
  - `POST` syncs paid eBay orders.
- Added manual `Sync eBay sales` button on the Listings page.
- Added daily cron piggyback job `daily-ebay-sales-sync`.
- Matching supports both SKU shapes:
  - existing listing-id SKU: `pdos-<listingId>`
  - future item-id SKU: `pdos-<inventoryItemId>`
- Future eBay offer/preflight/fallback publish paths now use the inventory item id as the SKU.
- Matched orders reuse the same unit-sale logic as the manual Sell button.
- Matched imports create normal `Sale` rows, close stock/listings and add an inbox alert.
- Unmatched orders are stored and shown as `need matching`; the app does not guess.
- Imported sales automatically feed owned-sales comps because they land in the normal sales table.

Production sync state:

- `/api/ebay/orders/sync` returned 200.
- Current import queue: 0 rows.
- Current unmatched queue: 0 rows.
- First synced order: none yet. No paid matching eBay order was returned/imported during this sweep.

Fee note:

- eBay sale price is booked from the buyer-paid total.
- eBay fees are currently estimated from the app's selling-fee model.
- Postage cost uses the current raw/slab postage estimate.
- Exact payout/fee reconciliation is deferred to a later Finances API pass.

## Commits

- `c6c3c83` - Harden eBay live publish path
- `7b04933` - Add listing photo capture workflow
- `e16adb8` - Add eBay UK ask evidence
- `3a0b0b6` - Import eBay sales into ledger

## Gates

E3 local gates:

- `node --import tsx --test src/lib/ebay/orders.test.ts src/lib/ebay/ebay.test.ts src/lib/backup/ledgerBackup.test.ts src/lib/alerts/inbox.test.ts` passed.
- `npx tsc -p tsconfig.check.json --pretty false` passed.
- `npm test` passed: 652 tests.
- `NEXT_TELEMETRY_DISABLED=1 npm run build` passed.

Production gates:

- Prisma migration `20260703150000_add_ebay_order_imports` applied to Neon.
- Vercel production deploy succeeded.
- `npm run verify:prod` passed 5/5.

## Remaining follow-ups

- Add the missing eBay location env vars in Vercel for cleaner one-tap seller-location creation.
- Validate one real photo-backed eBay publish from the phone with a low-risk listing.
- After real eBay sales exist, run `Sync eBay sales` and confirm the first paid order imports into Poke Deal.
- Build a richer manual-match screen for unmatched eBay order lines.
- Add eBay Finances API reconciliation for exact fees, payouts and refunds.
- Marketplace Insights remains out of scope until eBay grants the restricted access.
