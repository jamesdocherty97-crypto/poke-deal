-- Manual-review results only become work when the dealer explicitly requests it.
ALTER TABLE "CompResult"
  ADD COLUMN "reviewRequestedAt" TIMESTAMP(3),
  ADD COLUMN "reviewExpiresAt" TIMESTAMP(3);

CREATE INDEX "CompResult_reviewRequestedAt_reviewExpiresAt_idx"
  ON "CompResult"("reviewRequestedAt", "reviewExpiresAt");

-- Keep the newest target for each card + grade, then make future watch writes an upsert.
UPDATE "Alert" alert
SET "watchId" = newer."id"
FROM "Watch" older, "Watch" newer
WHERE alert."watchId" = older."id"
  AND older."cardId" = newer."cardId"
  AND older."grade" = newer."grade"
  AND (older."createdAt", older."id") < (newer."createdAt", newer."id");

DELETE FROM "Watch" older
USING "Watch" newer
WHERE older."cardId" = newer."cardId"
  AND older."grade" = newer."grade"
  AND (older."createdAt", older."id") < (newer."createdAt", newer."id");

CREATE UNIQUE INDEX "Watch_cardId_grade_key" ON "Watch"("cardId", "grade");

-- A listing cannot truthfully be SOLD unless the inventory/sale transaction completed.
-- Reconcile legacy orphan rows (including the known Pikachu row) back to ENDED.
UPDATE "Listing" listing
SET "state" = 'ENDED',
    "endedAt" = COALESCE(listing."endedAt", CURRENT_TIMESTAMP)
WHERE listing."state" = 'SOLD'
  AND NOT EXISTS (
    SELECT 1 FROM "InventoryItem" item
    WHERE item."id" = listing."itemId" AND item."status" = 'SOLD'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Sale" sale WHERE sale."itemId" = listing."itemId"
  );

CREATE OR REPLACE FUNCTION "enforce_sold_listing_has_sale"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."state" = 'SOLD' AND NOT EXISTS (
    SELECT 1 FROM "Sale" sale WHERE sale."itemId" = NEW."itemId"
  ) THEN
    RAISE EXCEPTION 'Listing cannot become SOLD without a booked inventory sale';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Listing_sold_requires_sale"
AFTER INSERT OR UPDATE OF "state" ON "Listing"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_sold_listing_has_sale"();
