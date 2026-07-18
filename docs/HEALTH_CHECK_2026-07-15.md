# Deep Source Health - 2026-07-15

Checked against production at `https://poke-deal.vercel.app/api/system/health` on 2026-07-15T17:33:27.468Z.

| Status | Source | Required | Detail | Latency |
|---|---|---|---|---|
| OK | Price Tracker | yes | PSA 10 sample 264, median £1050.67. | 4986ms |
| OK | PokeTrace | no | RAW signal 482, median £266.14. | 3027ms |
| OK | Pokemon TCG API | yes | Charizard ex 199/165 resolved with art. | 9071ms |
| FAIL | PSA cert lookup | no | PSA HTTP 429 | 742ms |
| OK | FX rates | no | live freecurrencyapi, as of 2026-07-15T00:00:00.000Z. | 5427ms |
| OK | eBay Browse asks | no | Browse API reachable; no listings survived the relevance filters for the health card. | 3482ms |
| OK | eBay Sell API | no | Token source db; policies ready. | 5034ms |
| SKIPPED | eBay Marketplace Insights | no | Restricted MI access not enabled. | 54ms |
| OK | Neon database | yes | 18 inventory rows reachable. | 2463ms |
| OK | Blob storage | no | 1 blob sampled. | 419ms |

## Notes

- Required source failures fail the health gate.
- Optional failures/skips stay visible so the dealer can see what is not live.
