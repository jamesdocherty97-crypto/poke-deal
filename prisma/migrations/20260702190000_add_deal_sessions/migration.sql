-- CreateEnum
CREATE TYPE "DealSessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "DealSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DealSessionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    "paidPence" INTEGER,

    CONSTRAINT "DealSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealSessionLine" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "cardId" TEXT,
    "name" TEXT NOT NULL,
    "setName" TEXT,
    "setCode" TEXT,
    "number" TEXT,
    "tcgApiId" TEXT,
    "tcgDexId" TEXT,
    "imageUrl" TEXT,
    "grade" "Grade" NOT NULL DEFAULT 'RAW',
    "headlinePence" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "manualCheck" BOOLEAN NOT NULL DEFAULT false,
    "maxCashOfferPence" INTEGER,
    "maxTradeOfferPence" INTEGER,
    "dealerOfferPence" INTEGER,
    "netProceedsPence" INTEGER,
    "expectedProfitPence" INTEGER,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "windowDays" INTEGER NOT NULL DEFAULT 0,
    "compSource" TEXT,
    "compAsOf" TIMESTAMP(3),
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealSessionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealSession_status_idx" ON "DealSession"("status");

-- CreateIndex
CREATE INDEX "DealSession_createdAt_idx" ON "DealSession"("createdAt");

-- CreateIndex
CREATE INDEX "DealSessionLine_sessionId_idx" ON "DealSessionLine"("sessionId");

-- CreateIndex
CREATE INDEX "DealSessionLine_cardId_idx" ON "DealSessionLine"("cardId");

-- AddForeignKey
ALTER TABLE "DealSessionLine" ADD CONSTRAINT "DealSessionLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DealSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealSessionLine" ADD CONSTRAINT "DealSessionLine_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
