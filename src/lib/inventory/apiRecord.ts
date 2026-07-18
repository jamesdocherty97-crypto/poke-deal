import type { Prisma } from "@prisma/client";

/**
 * Relations required by the client immediately after a stock mutation.
 * Mutation responses must stay aligned with GET /api/inventory so list, sale,
 * photo and cost controls can render the new row without a reload.
 */
export const inventoryItemUiInclude = {
  card: true,
  listings: { orderBy: { createdAt: "desc" } },
  sales: { orderBy: { soldAt: "desc" } },
  photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.InventoryItemInclude;
