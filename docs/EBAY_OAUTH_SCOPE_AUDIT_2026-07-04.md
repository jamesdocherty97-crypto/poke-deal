# eBay OAuth Scope Audit — 2026-07-04

## Result

The app now requests the full user-consent scope set needed by the eBay features already in the codebase:

- `sell.inventory` for inventory items, offers, offer publish, and merchant locations.
- `sell.account` and `sell.account.readonly` for payment, fulfillment, return-policy and privilege checks.
- `sell.fulfillment` and `sell.fulfillment.readonly` for importing James's own eBay sales through the Fulfillment Orders API.
- Base `api_scope` for general OAuth-backed eBay access.

The important production implication is that existing refresh tokens do not automatically gain newly-added scopes. After deploy, reconnect eBay from `/api/ebay/connect?force=1` so the consent screen grants the new sales-sync permissions.

## Calls Checked

| Area | App path | eBay API path | Scope covered |
| --- | --- | --- | --- |
| Listing inventory | `src/lib/ebay/inventoryItem.ts` | `/sell/inventory/v1/inventory_item/{sku}` | `sell.inventory` |
| Create/update offer | `src/lib/ebay/offer.ts` | `/sell/inventory/v1/offer` and `/offer/{id}` | `sell.inventory` |
| Publish offer | `src/lib/ebay/offer.ts` | `/sell/inventory/v1/offer/{id}/publish` | `sell.inventory` |
| Merchant location | `src/lib/ebay/location.ts` | `/sell/inventory/v1/location` | `sell.inventory` |
| Policies | `src/lib/ebay/policies.ts` | `/sell/account/v1/*_policy` | `sell.account` / `sell.account.readonly` |
| Account privilege | `src/lib/ebay/policies.ts` | `/sell/account/v1/privilege` | `sell.account.readonly` |
| Own sales import | `src/lib/ebay/orders.ts` | `/sell/fulfillment/v1/order` | `sell.fulfillment` / `sell.fulfillment.readonly` |
| Trading preflight/live listing | `src/lib/ebay/trading.ts` | Trading API XML with OAuth IAF token | User OAuth token |
| Live asking prices | `src/lib/ebay/browseAsks.ts` | `/buy/browse/v1/item_summary/search` | Application token with base `api_scope` |

## Marketplace Insights Honesty

eBay Marketplace Insights remains approval-gated. The app now shows this as an informational pending source rather than implying a missing local env var. Code is ready behind `EBAY_INSIGHTS_ENABLED=true` / `EBAY_MARKETPLACE_INSIGHTS_ENABLED=true`, but production should not claim automated UK sold-grade comps are live until eBay grants access.

## Error Behaviour

When eBay returns a permission/scope error such as error id `1100`, app endpoints now surface:

- a plain English reconnect hint,
- `/api/ebay/connect?force=1`,
- and a message suitable for cron failure alerts.
