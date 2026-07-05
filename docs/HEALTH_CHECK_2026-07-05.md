# Deep Source Health - 2026-07-05

Checked against production at `https://poke-deal.vercel.app/api/system/health` on 2026-07-05T00:05:03.090Z.

| Status | Source | Required | Detail | Latency |
|---|---|---|---|---|
| OK | Price Tracker | yes | PSA 10 sample 255, median £1011.18. | 1420ms |
| OK | PokeTrace | no | RAW signal 3794, median £311.40. | 1359ms |
| OK | Pokemon TCG API | yes | Charizard ex 199/165 resolved with art. | 1331ms |
| FAIL | PSA cert lookup | no | PSA HTTP 429 | 748ms |
| OK | FX rates | no | live freecurrencyapi, as of 2026-07-05T00:00:00.000Z. | 1714ms |
| OK | eBay Browse asks | no | Browse API reachable; no listings survived the relevance filters for the health card. | 1372ms |
| OK | eBay Sell API | no | Token source db; policies ready. | 1866ms |
| SKIPPED | eBay Marketplace Insights | no | Restricted MI access not enabled. | 75ms |
| OK | Neon database | yes | 14 inventory rows reachable. | 1354ms |
| OK | Blob storage | no | 1 blob sampled. | 628ms |

## Notes

- Required source failures fail the health gate.
- Optional failures/skips stay visible so the dealer can see what is not live.
