# Cron Health — 2026-07-04

Checked at: 2026-07-04T22:17:11.925Z

| Status | Job | Latest successful run | Latest run | Note |
|---|---|---|---|---|
| OK | Daily portfolio snapshot | 2026-07-04 · 2026-07-04T07:40:22.297Z | 2026-07-04 · SUCCESS | Last success 15h ago. |
| OK | Daily buy-watch check | 2026-07-04 · 2026-07-04T07:40:22.297Z | 2026-07-04 · SUCCESS | Last success 15h ago. |
| FAILED | Daily eBay sales sync | none | 2026-07-04 · FAILED | eBay API (/sell/fulfillment/v1/order?filter=creationdate%3A%5B2026-06-20T07%3A40%3A22.297Z..2026-07-04T07%3A40%3A22.297Z%5D&limit=10): Insufficient permissions to fulfill the request. (errorId 1100) |
| OK | Weekly stock health reprice | 2026-W27 · 2026-07-03T00:36:21.042Z | 2026-W27 · SUCCESS | Last success 46h ago. |

## Recent Cron Failure Inbox Entries

| Created | Title | Message |
|---|---|---|
| 2026-07-04T07:40:57.507Z | Daily eBay sales sync | eBay API (/sell/fulfillment/v1/order?filter=creationdate%3A%5B2026-06-20T07%3A40%3A22.297Z..2026-07-04T07%3A40%3A22.297Z%5D&limit=10): Insufficient permissions to fulfill the request. (errorId 1100) |

## Action

The code already requests `sell.fulfillment` and `sell.fulfillment.readonly` scopes. This failure means the stored eBay seller consent is stale or was granted before those scopes were added. Reconnect eBay once through `/api/ebay/connect?force=1`, then rerun the sales sync cron.
