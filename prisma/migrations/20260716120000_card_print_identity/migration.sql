-- Preserve print-level identity so similarly named variants cannot share comps.
ALTER TABLE "Card" ADD COLUMN "edition" TEXT;
ALTER TABLE "Card" ADD COLUMN "finish" TEXT;

CREATE INDEX "Card_cardmarketId_idx" ON "Card"("cardmarketId");
CREATE INDEX "Card_print_identity_idx" ON "Card"("game", "language", "setName", "number", "edition", "finish");

-- Keep binder/lot lines print-specific until they become inventory rows.
ALTER TABLE "DealSessionLine" ADD COLUMN "cardmarketId" TEXT;
ALTER TABLE "DealSessionLine" ADD COLUMN "language" "Language" NOT NULL DEFAULT 'EN';
ALTER TABLE "DealSessionLine" ADD COLUMN "edition" TEXT;
ALTER TABLE "DealSessionLine" ADD COLUMN "finish" TEXT;

-- Persist exact scan/correction identity so dealer corrections can improve
-- future evaluation without collapsing variants into a text note.
ALTER TABLE "ScanEvent" ADD COLUMN "edition" TEXT;
ALTER TABLE "ScanEvent" ADD COLUMN "finish" TEXT;
ALTER TABLE "ScanEvent" ADD COLUMN "tcgApiId" TEXT;
ALTER TABLE "ScanEvent" ADD COLUMN "tcgDexId" TEXT;
ALTER TABLE "ScanEvent" ADD COLUMN "cardmarketId" TEXT;
