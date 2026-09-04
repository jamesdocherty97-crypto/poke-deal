-- Leave historical amounts unknown: today's inventory cost cannot prove the
-- cost at an old sale, and old default fees/postage were not confirmed costs.
ALTER TABLE "Sale"
  ADD COLUMN "costBasis" INTEGER,
  ADD COLUMN "itemRevenue" INTEGER,
  ADD COLUMN "costsEstimated" BOOLEAN,
  ADD COLUMN "amountRevisions" JSONB;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_costBasis_nonnegative" CHECK ("costBasis" IS NULL OR "costBasis" >= 0),
  ADD CONSTRAINT "Sale_itemRevenue_bounded" CHECK ("itemRevenue" IS NULL OR ("itemRevenue" >= 0 AND "itemRevenue" <= "salePrice"));

-- Opening-stock retries reuse the listing mutation key after an interrupted response.
ALTER TABLE "Listing" ADD COLUMN "clientMutationId" TEXT;
CREATE UNIQUE INDEX "Listing_clientMutationId_key" ON "Listing"("clientMutationId");
