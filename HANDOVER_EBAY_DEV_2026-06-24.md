# eBay Integration Handover — 2026-06-24

## Status summary

| Item | Status |
|---|---|
| eBay library layer | **Done** |
| API routes | **Done** |
| UI integration | **Done** |
| Readiness checks + row actions | **Done** (0997cca) |
| Tests | **328/328 pass** |
| TypeScript check | **Clean** |
| Build | **Clean** |
| eBay Developer account created | **Done** — keyset "Poke Deal" exists |
| Client ID captured | **Done** — see below |
| Cert ID / Client Secret | **Pending** — portal was erroring; read from keys page when it recovers |
| Keyset compliance | **Pending** — keyset flagged Non Compliant; needs exemption applied |
| Redirect URLs / RuName | **Pending** — User Tokens page was erroring |
| OAuth completed | **Not yet** — awaiting full credentials |
| Offer created | **Not yet** |
| Published live | **No** |

---

## eBay Developer — what's been done

**Account:** `jiddlecards` on developer.ebay.com  
**App name:** Poke Deal  
**Client ID (App ID):** `JamesDoc-PokeDeal-PRD-2dcdd52e5-8b209a0b`

The Production keyset was created on 2026-06-24. The portal was experiencing errors so the Cert ID, Dev ID, and RuName could not be retrieved in the same session.

**Remaining portal steps (do when developer.ebay.com is stable):**

1. Go to https://developer.ebay.com/my/keys
2. Under "Poke Deal" → click **"marketplace deletion/account closure notification"** → apply for exemption (or agree to the process). This un-disables the keyset.
3. Click **"Cert ID (Client Secret)"** row — copy the value.
4. Click **User Tokens** → scroll to "OAuth Accepted URLs" → add:
   - `https://poke-deal.vercel.app/api/ebay/oauth/callback`
   - `http://localhost:3000/api/ebay/oauth/callback`
5. Copy the **RuName** that appears (looks like `JamesDo-PokeDeal-PRD-xxxxxxxx-xxxxxxxx`).
6. Optionally fill in the identity/address verification form on the User Tokens page (legal name + address).

**Then** add to `.env` and Vercel:
```
EBAY_CLIENT_ID=JamesDoc-PokeDeal-PRD-2dcdd52e5-8b209a0b
EBAY_CLIENT_SECRET=<cert id from step 3>
EBAY_RU_NAME=<runame from step 5>
```

---

## Env var names

Set all of these in Vercel (Project → Settings → Environment Variables) **and** locally in `.env`:

| Variable | Value | Where to find |
|---|---|---|
| `EBAY_ENV` | `production` | hardcoded |
| `EBAY_CLIENT_ID` | your app Client ID | eBay Developer > Application keys |
| `EBAY_CLIENT_SECRET` | your app Client Secret | eBay Developer > Application keys |
| `EBAY_RU_NAME` | the RuName identifier (not the full URL) | eBay Developer > User tokens > RuName |
| `EBAY_MARKETPLACE_ID` | `EBAY_GB` | hardcoded |
| `EBAY_REFRESH_TOKEN` | (set after completing OAuth) | shown at `/api/ebay/oauth/callback` after OAuth |

**Do not commit secrets.**

---

## Routes added

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ebay/connect` | Redirects to eBay OAuth consent page |
| GET | `/api/ebay/oauth/callback` | Exchanges auth code for tokens; shows refresh token to user once |
| GET | `/api/ebay/status` | Returns `{ configured, connected, env, policies }` |
| POST | `/api/listings/[id]/ebay/offer` | Creates eBay inventory item + offer for the listing; stores offer ID in `externalRef` |
| POST | `/api/listings/[id]/ebay/publish` | Publishes the pending offer; sets listing ACTIVE with eBay listing ID + URL |

---

## Files changed / added

### New library files
- `src/lib/ebay/config.ts` — env reading, `getEbayConfig()`, `isEbayConfigured()`
- `src/lib/ebay/oauth.ts` — `buildAuthUrl()`, `exchangeCodeForTokens()`, `refreshAccessToken()`
- `src/lib/ebay/tokens.ts` — `getAccessToken()` (uses EBAY_REFRESH_TOKEN, caches access token in memory)
- `src/lib/ebay/client.ts` — `ebayFetch()`, `ebayJson()` wrappers with auth headers
- `src/lib/ebay/policies.ts` — `fetchEbayPolicies()` from Account API (payment, fulfillment, return, location)
- `src/lib/ebay/inventoryItem.ts` — `buildInventoryItemPayload()`, `upsertInventoryItem()`
- `src/lib/ebay/offer.ts` — `buildOfferPayload()`, `createEbayOffer()`, `getOfferBySku()`, `publishEbayOffer()`
- `src/lib/ebay/ebay.test.ts` — 18 new tests covering all eBay functions

### New API routes
- `src/app/api/ebay/connect/route.ts`
- `src/app/api/ebay/oauth/callback/route.ts`
- `src/app/api/ebay/status/route.ts`
- `src/app/api/listings/[id]/ebay/offer/route.ts`
- `src/app/api/listings/[id]/ebay/publish/route.ts`

### Modified files
- `src/app/page.tsx` — Added `EbayStatus` type, `externalRef` to Listing type, `ebayStatus` + `ebayPublishConfirm` state, `createEbayOffer()` + `publishEbayListing()` functions, eBay controls in `ListingPackSheet`
- `.env` — Updated eBay section with new var names
- `.env.example` — Same
- `package.json` — Added `src/lib/ebay/ebay.test.ts` to test command

---

## Key design decisions

### Token storage
**EBAY_REFRESH_TOKEN env var.** After completing OAuth at `/api/ebay/connect`, the callback page shows the refresh token once. Save it in Vercel and `.env`. Refresh tokens are valid ~18 months. Access tokens are minted on demand from the refresh token and cached in module memory (reused within warm lambda invocations).

### SKU naming
`pdos-{listingId}` — unique per listing, stable across retries.

### Offer ID tracking
Before publish: `listing.externalRef = "offer:{offerId}"` (prefix distinguishes it from a published listing ID).
After publish: `listing.externalRef = "{ebayListingId}"`, `listing.externalUrl = "https://www.ebay.co.uk/itm/{id}"`, `listing.state = "ACTIVE"`.
No schema migration required.

### eBay category
`183454` — Individual Cards > CCG > Pokémon on eBay UK. Hardcoded in `src/lib/ebay/config.ts` as `EBAY_UK_CATEGORY_POKEMON`. Verify with eBay Taxonomy API if listings are rejected.

### Business policies
Fetched from Account API on each offer creation. Uses the first policy of each type (payment, fulfillment, return). If none exist, the offer route returns a clear error directing the user to create them in My eBay.

### Condition mapping
- PSA/BGS/CGC graded slabs → `GRADED`
- Raw cards → `LIKE_NEW` (Near Mint assumption)

---

## Tests run

```
npm test        → 318/318 pass
npx tsc -p tsconfig.check.json --noEmit  → no errors
npm run build   → clean
```

Smoke tests:
- `GET /api/ebay/status` → `{"configured":false,"connected":false}` ✓ (no credentials set yet)
- `GET /api/ebay/connect` → 503 with setup hint ✓

---

## Remaining blockers

1. **eBay Developer credentials** — Need Client ID, Client Secret, RuName from developer.ebay.com. Fill into `.env` and Vercel.
2. **OAuth completion** — Visit `/api/ebay/connect` (local or production), authorize the app, copy refresh token from callback page, save as `EBAY_REFRESH_TOKEN`.
3. **Business policies** — Ensure at least one payment policy, fulfillment/shipping policy, and return policy exist in My eBay > Account > Business policies. The app will error clearly if they're missing.
4. **Merchant location** — Optionally set up a merchant location in My eBay. The app works without one (eBay will use account default).
5. **Category verification** — Category `183454` should be correct for Pokémon individual cards on eBay UK. If offer creation returns a category error, verify via eBay Taxonomy API.

---

## Exact next steps for Codex

1. Get credentials from eBay Developer console (login → My Keys → app details).
2. Add to `.env`:
   ```
   EBAY_CLIENT_ID=<value>
   EBAY_CLIENT_SECRET=<value>
   EBAY_RU_NAME=<value>
   ```
3. Add same to Vercel env vars.
4. Restart dev server: `npm run dev`
5. Visit `http://localhost:3000/api/ebay/status` — should now show `configured: true, connected: false`.
6. Visit `http://localhost:3000/api/ebay/connect` — redirected to eBay OAuth.
7. Log in with the eBay seller account and authorize.
8. On callback page, copy the refresh token. Save as `EBAY_REFRESH_TOKEN` in `.env` and Vercel.
9. Restart dev server.
10. Visit `/api/ebay/status` — should now show `configured: true, connected: true` with policy IDs.
11. In the app, open Listings → open a listing pack (eBay channel listing) → "Create eBay offer" button appears.
12. Click "Create eBay offer" — verify in eBay Seller Hub that a draft offer appears.
13. Click "Publish to eBay" → confirm → verify live listing appears on eBay.co.uk.
14. Only after manual verification on one test listing, use on real inventory.
