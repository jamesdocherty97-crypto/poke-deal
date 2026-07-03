CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "perGbp" DOUBLE PRECISION NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FxRate_quote_asOf_key" ON "FxRate"("quote", "asOf");
CREATE INDEX "FxRate_asOf_idx" ON "FxRate"("asOf");
CREATE INDEX "FxRate_fetchedAt_idx" ON "FxRate"("fetchedAt");
