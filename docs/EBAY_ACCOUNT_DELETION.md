# eBay account-deletion handling

Older full order-import payloads can contain buyer account identifiers, names or addresses. The importer now keeps only an allowlisted operational projection, and a one-off scrub brings historical rows to that same projection.

eBay's [deletion notification guide](https://developer.ebay.com/develop/guides-v2/marketplace-user-account-deletion) describes 204 as acknowledgement of receipt and retries notifications that are not acknowledged. The [eBay SDK](https://github.com/eBay/event-notification-nodejs-sdk#features) processes the message before responding with 204. Once the scrub is verified, no stored account data is left to process, so acknowledging a verified notification completes it. That is why the scrub is a deployment precondition, not an optional cleanup.

## Callback behavior

- GET challenge verification is database-free: SHA-256 of `challenge_code`, the verification token and the registered endpoint, returned as `{"challengeResponse": "..."}` with `application/json`.
- POST verifies the signature (eBay Notification API public key, ECDSA), the `MARKETPLACE_ACCOUNT_DELETION` topic and usable account identifiers, then returns 204 with no database access. The route's import graph excludes the database client, and route tests fail if it is touched.
- Failures keep eBay's retry semantics: a missing signature or bad signature is 412, a malformed body 400/413, missing eBay config or a failed public-key lookup 503.
- The log line `ebay_account_deletion_processed` carries the notification ID only, never account identifiers.

Acknowledging without processing is correct only because nothing stored identifies an eBay account. New imports persist the allowlisted projection in `src/lib/ebay/orderImportPayload.ts` (order and line scalars, plus eBay's own amounts on held non-GBP lines). Older rows are cleared once by `scripts/scrub-ebay-order-import-buyers.ts`, which rewrites each legacy payload to that same projection and clears anything unrecognisable to database NULL (`Prisma.DbNull`; `Prisma.AnyNull` skips both null kinds). It writes only `payload`, conditionally on `updatedAt`, so seller ledger fields and concurrent imports are untouched.

## Before deploying the database-free callback

The scrub must have run against production, and been verified, before this callback ships. Until then the previous callback, which scrubs per notification, stays deployed.

1. Back up first (`npm run backup`), following the agreed backup procedure.
2. Dry run, which only reads: `DATABASE_URL=<production direct URL> npm run scrub:ebay-buyers`. It prints the database host and counts only.
3. Apply: rerun with `-- --apply`. It is idempotent; rerun if it reports `skippedConcurrent`.
4. Verify: a second dry run must report `rewritten: 0` and `cleared: 0`. Record the database target, time and commit, without buyer data or credentials.
5. Merge and deploy, then exercise the GET challenge from eBay's developer portal notification settings.

Backups and exports taken before the scrub may still hold full payloads. Restoring one must be followed by another scrub run. Reviewing or deleting old backups is a separate owner decision.
