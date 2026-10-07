# eBay account-deletion handling

Older full order-import payloads can contain buyer account identifiers, names or addresses. The current importer keeps an explicit operational projection instead of the full provider response. That protects new imports; it does not prove historical payloads or older backups have been cleaned.

eBay's [deletion notification guide](https://developer.ebay.com/develop/guides-v2/marketplace-user-account-deletion) describes 204 as acknowledgement of receipt and retries notifications that are not acknowledged. A quick acknowledgement can be followed by durable processing, but this app has no deletion work queue. Returning 204 while skipping all processing can therefore drop the request. The [eBay SDK](https://github.com/eBay/event-notification-nodejs-sdk#features) likewise processes the message before responding with 204.

## Callback behavior

- GET challenge verification is database-free.
- POST verifies the signature, expected topic and usable account identifiers before accessing the database.
- Every verified deletion notification scans non-null historical import payloads for an exact identifier match, including nested objects and arrays. A matching row's entire extra payload becomes database NULL using `Prisma.DbNull`. Normalized import fields, sales and inventory are preserved. Unrelated payloads are unchanged.
- Database NULL and stored JSON null are both excluded with `Prisma.AnyNull`.
- The callback acknowledges only after all required writes finish. A read or write error returns 503. If some rows were cleared before a failure, redelivery clears the remaining matches; duplicate deliveries are idempotent.
- `EBAY_DELETION_SCRUB` is retired and ignored, including an existing value of `0`. There is no unchecked configuration bypass.

This restores database access on valid deletion callbacks and can keep Neon awake when notifications are frequent. Eliminating these reads needs a separately verified cleanup or a durable deletion-processing design. Database cost alone is not evidence that processing can be skipped.

## Before production

The code change does not require a schema migration or configuration change. Merge and production rollout remain separate authorized actions. Local and CI tests use synthetic records; they do not establish the state of production data.

An authorized operator should:

1. Verify the exact deployed commit and exercise signature, retry and acknowledgement behavior with a controlled synthetic fixture, without logging account identifiers or payloads.
2. If investigating historical cleanup, obtain approval for the production read first. Use aggregate counts to distinguish database NULL, JSON null, the current allowlisted projection and older full payloads. Do not export buyer records or assume a schema-version marker alone proves a payload has no extra fields.
3. Obtain separate approval before any bulk redaction or cleanup. Scope it to legacy extra payloads, preserve normalized seller ledger facts, and prepare the agreed backup/rollback procedure. A previously mentioned cleanup command is not proof it ran.
4. Verify the result with aggregate evidence and unchanged ledger counts/totals. Record the database target, verification time and code/importer version without recording buyer data or credentials.
5. Review retention and restore procedures separately: older backups/exported import rows may contain the original payloads. Restoring them must not silently reintroduce material that was scrubbed. Do not inspect, delete or rewrite backups without the owner's authorization.

Do not enable a database-free acknowledgement based only on a comment, an unset variable or an unverified operator assertion. Requests acknowledged by the old bypass were not queued; this patch cannot reconstruct those requests. Any catch-up cleanup is a separate approved operation.
