ALTER TABLE "Card" ADD COLUMN "tcgDexId" TEXT;
CREATE UNIQUE INDEX "Card_tcgDexId_key" ON "Card"("tcgDexId");
CREATE INDEX "Card_setName_idx" ON "Card"("setName");
CREATE INDEX "Card_setCode_idx" ON "Card"("setCode");
