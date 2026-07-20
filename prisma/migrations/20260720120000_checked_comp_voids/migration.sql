-- Checked-comp observations remain append-only when a dealer corrects bad
-- evidence. A voided row stays auditable but releases its listing ID so the
-- exact sold item can be logged again with corrected facts.
ALTER TABLE "CheckedComp"
  ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "voidReason" TEXT;

DROP INDEX IF EXISTS "CheckedComp_sourceListingId_key";

CREATE UNIQUE INDEX "CheckedComp_sourceListingId_key"
  ON "CheckedComp"("sourceListingId")
  WHERE "voidedAt" IS NULL;

CREATE INDEX "CheckedComp_voidedAt_idx"
  ON "CheckedComp"("voidedAt");
