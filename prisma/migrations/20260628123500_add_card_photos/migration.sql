CREATE TYPE "PhotoRole" AS ENUM ('FRONT', 'BACK', 'SLAB', 'EXTRA');

CREATE TABLE "CardPhoto" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "role" "PhotoRole" NOT NULL DEFAULT 'FRONT',
    "width" INTEGER,
    "height" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CardPhoto_inventoryItemId_idx" ON "CardPhoto"("inventoryItemId");

ALTER TABLE "CardPhoto" ADD CONSTRAINT "CardPhoto_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
