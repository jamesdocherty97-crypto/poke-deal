-- CreateEnum
CREATE TYPE "Game" AS ENUM ('POKEMON', 'SOCCER');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'JP');

-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('RAW', 'PSA_1', 'PSA_2', 'PSA_3', 'PSA_4', 'PSA_5', 'PSA_6', 'PSA_7', 'PSA_8', 'PSA_9', 'PSA_10', 'BGS_9', 'BGS_9_5', 'BGS_10', 'CGC_9', 'CGC_9_5', 'CGC_10');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('IN_STOCK', 'LISTED', 'SOLD', 'RESERVED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EBAY', 'CARDMARKET', 'VINTED', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "ListingState" AS ENUM ('DRAFT', 'ACTIVE', 'SOLD', 'ENDED');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('PRICE_DROP', 'REPRICE');

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "game" "Game" NOT NULL DEFAULT 'POKEMON',
    "language" "Language" NOT NULL DEFAULT 'EN',
    "name" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "setCode" TEXT,
    "number" TEXT,
    "rarity" TEXT,
    "imageUrl" TEXT,
    "tcgApiId" TEXT,
    "cardmarketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "grade" "Grade" NOT NULL DEFAULT 'RAW',
    "graderCert" TEXT,
    "condition" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "costBasis" INTEGER NOT NULL,
    "acquiredFrom" TEXT,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" TEXT,
    "status" "InventoryStatus" NOT NULL DEFAULT 'IN_STOCK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "state" "ListingState" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "description" TEXT,
    "suggestedPrice" INTEGER,
    "listPrice" INTEGER,
    "externalRef" TEXT,
    "externalUrl" TEXT,
    "listedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "salePrice" INTEGER NOT NULL,
    "fees" INTEGER NOT NULL DEFAULT 0,
    "postage" INTEGER NOT NULL DEFAULT 0,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompResult" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "source" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "medianPence" INTEGER NOT NULL,
    "meanPence" INTEGER NOT NULL,
    "lowPence" INTEGER NOT NULL,
    "highPence" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "trendPct" DOUBLE PRECISION,
    "outliersRemoved" INTEGER NOT NULL DEFAULT 0,
    "asOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "marketPence" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watch" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "grade" "Grade" NOT NULL DEFAULT 'RAW',
    "targetPence" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "message" TEXT NOT NULL,
    "pence" INTEGER,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Card_tcgApiId_key" ON "Card"("tcgApiId");

-- CreateIndex
CREATE INDEX "Card_game_language_idx" ON "Card"("game", "language");

-- CreateIndex
CREATE INDEX "Card_name_idx" ON "Card"("name");

-- CreateIndex
CREATE INDEX "InventoryItem_status_idx" ON "InventoryItem"("status");

-- CreateIndex
CREATE INDEX "InventoryItem_cardId_grade_idx" ON "InventoryItem"("cardId", "grade");

-- CreateIndex
CREATE INDEX "Listing_channel_state_idx" ON "Listing"("channel", "state");

-- CreateIndex
CREATE INDEX "Sale_soldAt_idx" ON "Sale"("soldAt");

-- CreateIndex
CREATE INDEX "CompResult_cardId_grade_asOf_idx" ON "CompResult"("cardId", "grade", "asOf");

-- CreateIndex
CREATE INDEX "PriceSnapshot_takenAt_idx" ON "PriceSnapshot"("takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceSnapshot_cardId_grade_takenAt_key" ON "PriceSnapshot"("cardId", "grade", "takenAt");

-- CreateIndex
CREATE INDEX "Watch_active_idx" ON "Watch"("active");

-- CreateIndex
CREATE INDEX "Alert_delivered_idx" ON "Alert"("delivered");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompResult" ADD CONSTRAINT "CompResult_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "Watch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
