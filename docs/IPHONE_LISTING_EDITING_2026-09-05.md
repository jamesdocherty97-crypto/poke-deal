# iPhone listing editing — 5 September 2026

The owner uses Poke Deal almost entirely on an iPhone 16 Pro Max and wants easier editing of live eBay listings. This pass improves that daily flow within the existing Pokémon visual system, Next/React app and GBP-pence model.

## Flow and changes

1. **Find:** List initially includes all listings. One-tap Live/Drafts/All queues and search appear before supporting sales, setup and pack tools. A live card has a direct Edit live listing action.
2. **Read:** A native modal opens immediately and loads the current eBay price, title and description. Loading failures offer retry and a direct eBay link; stale saved values never masquerade as a freshly read listing.
3. **Edit:** Price is prominent, with the original price, acquisition cost and separate suggested guidance. Title and description are editable, with eBay's 80-character title limit. Only changed fields enter the save request. There are no state or channel controls on a live listing.
4. **Save:** A keyboard-aware, safe-area footer shows the changes and the explicit Update live eBay listing action. eBay must accept the update before the local record claims it. Failed/partial/unconfirmed updates preserve the entered text and provide a direct live-item check.
5. **Return:** Cancel protects unsaved work; closing returns focus to the initiating card without changing search/filter/sort. The editor remains mounted through same-document Back/Forward navigation, retaining entered values and pending saves even when the workspace behind it changes. Acknowledged changes paint immediately, while the rest of the workspace refreshes in the background.

The modal uses native focus/inert behaviour, 16px or larger input text, at least 44px controls and a single internal scroll region. It follows the visible viewport when the phone keyboard opens. Pokémon type colours, the existing font roles and a restrained Poké Ball mark carry the brand.

## Correctness

- Description previously did not trigger live sync, and offer-specific description could retain generated copy. Both now use the buyer-facing offer description.
- Live edits verify the stored offer's SKU, item ID, active/published fixed-price state and GBP marketplace against current eBay records. They preserve remote fields instead of rebuilding the listing from local stock and current default policies.
- Price-only changes use eBay's price update operation with quantity omitted and inspect the matching per-offer result. Title/description edits use the existing API's replacement operations with current remote fields preserved.
- Remote title and offer edits cannot be atomic together. Partial confirmation and a local-save failure after remote success are explicitly reported; there is no blind rollback.
- Sold/empty stock and pending offline sale reservations block edits that could increase marketplace exposure. Removal remains available through the separate listing removal flow.
- Trading fallback publication clears an old prepared Inventory API offer association, preventing later edits from targeting an unrelated offer.
- Body size, field lengths and money values are bounded. Production access, crawler exclusions, secure sessions, offline queues and the schema are unchanged.

## Deliberate limits

- Listings with no verified Inventory API offer still require editing on eBay. This includes manual links and Trading fallback publications, including new ones created when the seller account cannot use the Inventory API publish flow. Safe support needs verified listing ownership/origin and an appropriate Trading revision or adoption flow; a pasted URL alone is insufficient. The current owner's listing origins were not inspected.
- Live photos, condition, quantity, postage, returns, discounts and marketplace policies are outside this pass. The editor names this boundary instead of pretending that editing Stock updates those remote fields.
- Cardmarket/Vinted remain manual marketplace workflows; local edit success is labelled accordingly.
- No marketplace listing, sale, stock row or production database was modified during verification. All provider writes in tests are synthetic.
- Real iPhone keyboard/safe-area behaviour still benefits from owner device confirmation; browser-engine tests are not a claim to have operated the owner's phone.

## Source contracts

- [eBay listing management](https://developer.ebay.com/develop/guides/sell/listing-management)
- [eBay bulk price and quantity updates](https://developer.ebay.com/api-docs/sell/static/inventory/bulk-updates.html)
- [eBay updateOffer](https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/updateOffer)
- [eBay createOrReplaceInventoryItem](https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem)

## Verification

- 1,040 unit tests passed, plus 13 overhaul, 15 UX and the pricing red-team suite.
- TypeScript, an isolated clean production build and a zero-vulnerability dependency audit passed.
- The protected release gate passed all 44 Chromium journeys before the final navigation safeguard. The final gate reruns those and two new Back/Forward journeys.
- 26 focused Chromium/WebKit editor cases passed on the final navigation fix, including current remote copy, exact edit fields, retained failed saves, uncertain acknowledgements, whitespace preservation, dirty close, Safari focus return, Back/Forward draft and in-flight-save preservation, and draft/manual boundaries. Final geometry also passed at 320, 440, 640 and 1280px.
- Production Lighthouse 13.4.0 accessibility snapshots scored 100 for the queue and editor at 440 and 1280px. No page errors, unexpected requests or overflow were observed. An existing unscored desktop navigation label/accessible-name mismatch remains outside the editor changes.
- Local screenshots, detailed assertions and production reports are under ignored `output/playwright/listing-editor-2026-09-05/`. Release details are kept separately under `output/releases/`.

No schema migration or live marketplace mutation is needed to release this change.
