-- Additive architecture/reliability migration. All columns are nullable or
-- have a safe default; no existing evidence or ledger rows are rewritten.

ALTER TABLE "CompResult"
  ADD COLUMN IF NOT EXISTS "confidence" TEXT,
  ADD COLUMN IF NOT EXISTS "manualCheck" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reasons" JSONB,
  ADD COLUMN IF NOT EXISTS "receipt" JSONB,
  ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolution" TEXT,
  ADD COLUMN IF NOT EXISTS "resolutionNote" TEXT;

ALTER TABLE "ScanEvent"
  ADD COLUMN IF NOT EXISTS "latencyMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "requestBytes" INTEGER,
  ADD COLUMN IF NOT EXISTS "inputKind" TEXT,
  ADD COLUMN IF NOT EXISTS "sessionHash" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionKey" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionOfId" TEXT;

ALTER TABLE "InventoryItem"
  ADD COLUMN IF NOT EXISTS "clientMutationId" TEXT;

ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "clientMutationId" TEXT,
  ADD COLUMN IF NOT EXISTS "mutationIndex" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_clientMutationId_key"
  ON "InventoryItem"("clientMutationId");
CREATE UNIQUE INDEX IF NOT EXISTS "Sale_clientMutationId_mutationIndex_key"
  ON "Sale"("clientMutationId", "mutationIndex");

CREATE UNIQUE INDEX IF NOT EXISTS "ScanEvent_correctionKey_key"
  ON "ScanEvent"("correctionKey");

DO $$ BEGIN
  ALTER TABLE "ScanEvent"
    ADD CONSTRAINT "ScanEvent_correctionOfId_fkey"
    FOREIGN KEY ("correctionOfId") REFERENCES "ScanEvent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "InventoryItem_status_updatedAt_idx"
  ON "InventoryItem"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "Listing_itemId_state_idx"
  ON "Listing"("itemId", "state");
CREATE INDEX IF NOT EXISTS "Sale_itemId_soldAt_idx"
  ON "Sale"("itemId", "soldAt");
CREATE INDEX IF NOT EXISTS "CompResult_cardId_grade_createdAt_idx"
  ON "CompResult"("cardId", "grade", "createdAt");
CREATE INDEX IF NOT EXISTS "CompResult_manualCheck_resolvedAt_createdAt_idx"
  ON "CompResult"("manualCheck", "resolvedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "ScanEvent_sessionHash_createdAt_idx"
  ON "ScanEvent"("sessionHash", "createdAt");
CREATE INDEX IF NOT EXISTS "ScanEvent_correctionOfId_createdAt_idx"
  ON "ScanEvent"("correctionOfId", "createdAt");
CREATE INDEX IF NOT EXISTS "CronRun_status_startedAt_idx"
  ON "CronRun"("status", "startedAt");
