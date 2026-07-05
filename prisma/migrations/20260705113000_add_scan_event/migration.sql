CREATE TABLE "ScanEvent" (
    "id" TEXT NOT NULL,
    "cardId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'gemini-scan',
    "status" TEXT NOT NULL,
    "name" TEXT,
    "setName" TEXT,
    "setCode" TEXT,
    "number" TEXT,
    "language" "Language",
    "grade" "Grade",
    "condition" TEXT,
    "marketplace" "Channel",
    "model" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScanEvent_createdAt_idx" ON "ScanEvent"("createdAt");
CREATE INDEX "ScanEvent_cardId_createdAt_idx" ON "ScanEvent"("cardId", "createdAt");
CREATE INDEX "ScanEvent_source_status_idx" ON "ScanEvent"("source", "status");
CREATE INDEX "ScanEvent_name_idx" ON "ScanEvent"("name");

ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
