export type SaleLockDb = {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

/**
 * Serialize quantity planning for one inventory row. The caller must invoke
 * this inside the same interactive transaction as its read, Sale inserts and
 * quantity update.
 */
export async function lockInventoryItemForSale(db: SaleLockDb, inventoryItemId: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "InventoryItem" WHERE "id" = ${inventoryItemId} FOR UPDATE
  `;
  return rows.length > 0;
}
