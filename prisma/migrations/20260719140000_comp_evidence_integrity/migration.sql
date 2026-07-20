-- Additive evidence-integrity fields. Existing rows remain valid but are
-- deliberately unscoped/untraceable until the dealer records fresh evidence.
ALTER TABLE "CompResult"
  ADD COLUMN IF NOT EXISTS "condition" TEXT;

ALTER TABLE "CheckedComp"
  ADD COLUMN IF NOT EXISTS "condition" TEXT,
  ADD COLUMN IF NOT EXISTS "priceBasis" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "sourceListingId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CheckedComp_sourceListingId_key"
  ON "CheckedComp"("sourceListingId");

CREATE INDEX IF NOT EXISTS "CheckedComp_cardId_grade_condition_soldDate_idx"
  ON "CheckedComp"("cardId", "grade", "condition", "soldDate");

CREATE INDEX IF NOT EXISTS "CompResult_cardId_grade_condition_createdAt_idx"
  ON "CompResult"("cardId", "grade", "condition", "createdAt");
