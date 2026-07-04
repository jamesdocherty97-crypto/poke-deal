# Deep Source Health — 2026-07-04

Checked against production at `https://poke-deal.vercel.app/api/system/health` on 2026-07-04T22:13:38.363Z.

| Status | Source | Detail |
|---|---|---|
| OK | Price Tracker | PSA 10 sample 255, median £1011.18. |
| OK | PokeTrace | RAW signal 3794, median £311.40. |
| OK | Pokemon TCG API | Charizard ex 199/165 resolved with art. |
| FAIL (optional) | PSA cert lookup | PSA HTTP 429 during the production check. |
| OK | FX rates | Live freecurrencyapi rates, as of 2026-07-04T00:00:00.000Z. |
| OK | eBay Browse asks | API reachable; no listings survived the relevance filters for the health card. |
| OK | eBay Sell API | Token source DB; policies ready. |
| SKIPPED | eBay Marketplace Insights | Restricted MI access not enabled. |
| OK | Neon database | 12 inventory rows reachable. |
| OK | Blob storage | 1 blob sampled. |

## Notes

- The health command now fails the gate only when a required source fails. Optional integrations still show as `FAIL` or `SKIPPED` in the report so the dealer can see what is not live.
- PSA cert lookup was rate-limited/unavailable in this run. The UI should keep treating PSA as useful but non-blocking when PSA returns 429.
- eBay Sell API is connected for policies/listing readiness, but the daily sales-sync cron still needs one fresh `/api/ebay/connect?force=1` reconnect to grant fulfillment-order permissions.
- Marketplace Insights remains blocked by eBay approval; Browse asks and manual UK sold links are the current eBay-backed routes.
