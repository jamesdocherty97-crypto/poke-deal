CREATE TABLE "CheckedComp" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "pricePence" INTEGER NOT NULL,
    "soldDate" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ebay-uk',
    "note" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckedComp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckedComp_cardId_grade_soldDate_idx" ON "CheckedComp"("cardId", "grade", "soldDate");
CREATE INDEX "CheckedComp_createdAt_idx" ON "CheckedComp"("createdAt");

ALTER TABLE "CheckedComp" ADD CONSTRAINT "CheckedComp_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
