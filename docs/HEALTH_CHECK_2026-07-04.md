# Deep Source Health — 2026-07-04

Checked against local app code at `http://localhost:3000/api/system/health` before deploy.

| Status | Source | Detail |
|---|---|---|
| OK | Price Tracker | PSA 10 sample 255, median £1011.18. |
| OK | PokeTrace | RAW signal 3794, median £311.40. |
| OK | Pokemon TCG API | Charizard ex 199/165 resolved with art. |
| OK | PSA cert lookup | Cert 84213567 GEM MT 10 resolved. |
| OK | FX rates | Cached freecurrencyapi rates, as of 2026-07-04. |
| OK | eBay Browse asks | API reachable; no listings survived the relevance filters for the health card. |
| FAIL (optional/local) | eBay Sell API | Local `.env` is missing `TOKEN_ENCRYPTION_KEY` while Neon has a stored eBay token row. Production must be checked after deploy. |
| SKIPPED | eBay Marketplace Insights | Restricted MI access not enabled. |
| OK | Neon database | 12 inventory rows reachable. |
| OK | Blob storage | 1 blob sampled. |

## Notes

- The health command now fails the gate only when a required source fails. Optional integrations still show as `FAIL` or `SKIPPED` in the report so the dealer can see what is not live.
- eBay Sell API needs a production re-check after deploy. If it reports insufficient permissions, use `/api/ebay/connect?force=1` once to grant the current fulfillment scopes.
- Marketplace Insights remains blocked by eBay approval; Browse asks and manual UK sold links are the current eBay-backed routes.
