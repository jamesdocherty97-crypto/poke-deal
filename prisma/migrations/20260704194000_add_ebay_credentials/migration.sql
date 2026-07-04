CREATE TABLE "EbayCredential" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'default',
    "env" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "refreshTokenCiphertext" TEXT NOT NULL,
    "refreshTokenIv" TEXT NOT NULL,
    "refreshTokenTag" TEXT NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastValidatedAt" TIMESTAMP(3),

    CONSTRAINT "EbayCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EbayCredential_key_key" ON "EbayCredential"("key");
CREATE INDEX "EbayCredential_updatedAt_idx" ON "EbayCredential"("updatedAt");
