-- CreateEnum
CREATE TYPE "EbayOrderImportStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "AppAlertKind" ADD VALUE 'EBAY_SALE';

-- CreateTable
CREATE TABLE "EbayOrderImport" (
    "id" TEXT NOT NULL,
    "importKey" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "sku" TEXT,
    "ebayItemId" TEXT,
    "title" TEXT,
    "status" "EbayOrderImportStatus" NOT NULL DEFAULT 'UNMATCHED',
    "reason" TEXT,
    "itemId" TEXT,
    "listingId" TEXT,
    "saleId" TEXT,
    "orderCreatedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "buyerPaidPence" INTEGER,
    "postageChargedPence" INTEGER,
    "feesEstimatePence" INTEGER,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbayOrderImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EbayOrderImport_importKey_key" ON "EbayOrderImport"("importKey");

-- CreateIndex
CREATE UNIQUE INDEX "EbayOrderImport_saleId_key" ON "EbayOrderImport"("saleId");

-- CreateIndex
CREATE INDEX "EbayOrderImport_status_createdAt_idx" ON "EbayOrderImport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EbayOrderImport_orderId_idx" ON "EbayOrderImport"("orderId");

-- CreateIndex
CREATE INDEX "EbayOrderImport_sku_idx" ON "EbayOrderImport"("sku");

-- CreateIndex
CREATE INDEX "EbayOrderImport_itemId_idx" ON "EbayOrderImport"("itemId");

-- CreateIndex
CREATE INDEX "EbayOrderImport_listingId_idx" ON "EbayOrderImport"("listingId");

-- AddForeignKey
ALTER TABLE "EbayOrderImport" ADD CONSTRAINT "EbayOrderImport_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EbayOrderImport" ADD CONSTRAINT "EbayOrderImport_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EbayOrderImport" ADD CONSTRAINT "EbayOrderImport_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
