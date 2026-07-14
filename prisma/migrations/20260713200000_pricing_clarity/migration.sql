-- Track the eBay offer linked to this listing and its last successful price sync.
-- Existing offers intentionally remain NULL so the UI treats them as stale
-- and refreshes them before the next publish attempt.
ALTER TABLE "Listing"
  ADD COLUMN "ebayOfferId" TEXT,
  ADD COLUMN "offerSyncedAt" TIMESTAMP(3),
  ADD COLUMN "offerSyncedPrice" INTEGER;

UPDATE "Listing"
SET "ebayOfferId" = substring("externalRef" from 7)
WHERE "externalRef" LIKE 'offer:%';
