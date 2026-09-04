import { z } from "zod";
import { inventoryDraftRequestSchema } from "../inventory/apiSchemas.js";
import type { StockImportRow, ImportChannel } from "./stockImport.js";

export const STOCK_IMPORT_BATCH_KEY = "poke-deal.opening-stock-batch.v1";
const batchSchema = z.object({
  version: z.literal(1),
  id: z.string().min(8).max(80),
  sourceText: z.string().max(250_000),
  rows: z.array(z.object({
    mutationId: z.string().min(8).max(120),
    stock: inventoryDraftRequestSchema,
    channel: z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]),
    listPricePence: z.number().int().nonnegative().optional(),
    itemId: z.string().min(1).optional(),
    listingId: z.string().min(1).optional(),
  })).min(1).max(500),
});
export type StockImportBatch = z.infer<typeof batchSchema>;

export function parseStockImportBatch(value: string | null): StockImportBatch | null {
  if (!value) return null;
  try { return batchSchema.parse(JSON.parse(value)); } catch { return null; }
}

export function createStockImportBatch(
  sourceText: string,
  rows: StockImportRow[],
  defaults: { channel: ImportChannel; location?: string },
  id: string,
): StockImportBatch {
  const batch = batchSchema.parse({
    version: 1, id, sourceText,
    rows: rows.map((row, index) => ({
      mutationId: `import:${id}:${index}`,
      stock: {
        card: row.card, grade: row.grade, quantity: row.quantity,
        costBasisPence: row.costBasisPence, acquiredFrom: row.acquiredFrom ?? "Opening stock",
        location: row.location || defaults.location || undefined,
        condition: row.condition, graderCert: row.graderCert,
        ...(row.acquiredAt ? { acquiredAt: row.acquiredAt } : {}),
        status: "IN_STOCK",
      },
      channel: row.channel ?? defaults.channel,
      ...(row.listPricePence != null ? { listPricePence: row.listPricePence } : {}),
    })),
  });
  assertBatchCanRun(batch);
  return batch;
}

/** Check the complete batch before stock is written, including channel defaults. */
function assertBatchCanRun(batch: StockImportBatch): void {
  batch.rows.forEach((row, index) => {
    const prefix = `Row ${index + 1} (${row.stock.card.name})`;
    if (row.stock.costBasisPence > 2_147_483_647) {
      throw new Error(`${prefix}: cost must be no more than £21,474,836.47.`);
    }
    if (row.stock.quantity > 2_147_483_647) {
      throw new Error(`${prefix}: quantity must be no more than 2,147,483,647.`);
    }
    if (row.listPricePence == null) return;
    if (row.listPricePence <= 0 || row.listPricePence > 2_147_483_647) {
      throw new Error(`${prefix}: list price must be above £0 and no more than £21,474,836.47; leave it blank for an unpriced draft.`);
    }
    if (row.channel === "EBAY" && row.listPricePence < 99) {
      throw new Error(`${prefix}: eBay list price must be at least £0.99; leave it blank for an unpriced draft.`);
    }
  });
}

export function importBatchProgress(batch: StockImportBatch) {
  const stocked = batch.rows.filter((row) => row.itemId).length;
  const drafted = batch.rows.filter((row) => row.listingId).length;
  return { stocked, drafted, total: batch.rows.length, complete: drafted === batch.rows.length };
}

/** Save identifiers before writes; an unknown response is replayed with the same key. */
export async function runStockImportBatch(batch: StockImportBatch, deps: {
  save: (batch: StockImportBatch) => void | Promise<void>;
  stock: (row: StockImportBatch["rows"][number]) => Promise<string>;
  draft: (row: StockImportBatch["rows"][number] & { itemId: string }) => Promise<string>;
}) {
  const next = batchSchema.parse(batch);
  assertBatchCanRun(next);
  await deps.save(next);
  for (const row of next.rows) {
    if (!row.itemId) {
      row.itemId = await deps.stock(row);
      await deps.save(next);
    }
    if (!row.listingId) {
      row.listingId = await deps.draft({ ...row, itemId: row.itemId });
      await deps.save(next);
    }
  }
  return next;
}
