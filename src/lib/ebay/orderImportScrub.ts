import { Prisma } from "@prisma/client";
import { planOrderImportPayloadScrub } from "./orderImportPayload.js";

// One-off scrub for EbayOrderImport payloads written before imports stored
// only the buyer-free projection. Run by scripts/scrub-ebay-order-import-buyers.ts;
// dry-run unless the caller passes apply: true.

export type OrderImportScrubDb = {
  ebayOrderImport: Pick<Prisma.EbayOrderImportDelegate, "findMany" | "updateMany">;
};

export type OrderImportScrubOptions = { apply: boolean; batchSize: number };

export type OrderImportScrubSummary = {
  apply: boolean;
  scanned: number;
  alreadyMinimal: number;
  rewritten: number;
  cleared: number;
  /** Rows changed by something else between read and write; rerun to pick them up. */
  skippedConcurrent: number;
};

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;

export function parseScrubArgs(argv: readonly string[]): OrderImportScrubOptions {
  let apply = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") continue;
    else if (arg.startsWith("--batch-size=")) {
      const value = Number(arg.slice("--batch-size=".length));
      if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
        throw new Error(`--batch-size must be an integer from 1 to ${MAX_BATCH_SIZE}.`);
      }
      batchSize = value;
    } else {
      throw new Error(`Unknown argument ${JSON.stringify(arg)}. Use --apply to write; the default is a dry run.`);
    }
  }
  return { apply, batchSize };
}

/**
 * Walk every stored payload in id order and reduce it to the minimal
 * projection. Payloads already in that shape are untouched, so a second run
 * changes nothing. Only `payload` is written; seller ledger columns stay as
 * they are. Each write is conditional on `updatedAt` so a concurrent import
 * is never overwritten with a projection of its older payload.
 *
 * `payload` is a nullable Json column: the filter uses AnyNull to skip both
 * database NULL and stored JSON null, and a clear writes DbNull. Prisma 5
 * reads a plain `null` as JSON null, so plain `null` is never passed.
 */
export async function scrubOrderImportBuyerData(
  db: OrderImportScrubDb,
  options: OrderImportScrubOptions,
): Promise<OrderImportScrubSummary> {
  const summary: OrderImportScrubSummary = {
    apply: options.apply,
    scanned: 0,
    alreadyMinimal: 0,
    rewritten: 0,
    cleared: 0,
    skippedConcurrent: 0,
  };
  let afterId: string | null = null;

  for (;;) {
    const rows: Array<{ id: string; payload: Prisma.JsonValue; updatedAt: Date }> = await db.ebayOrderImport.findMany({
      where: { payload: { not: Prisma.AnyNull }, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true, payload: true, updatedAt: true },
      orderBy: { id: "asc" },
      take: options.batchSize,
    });
    if (rows.length === 0) break;
    afterId = rows.at(-1)!.id;

    for (const row of rows) {
      summary.scanned++;
      const plan = planOrderImportPayloadScrub(row.payload);
      if (plan.kind === "keep") {
        summary.alreadyMinimal++;
        continue;
      }
      if (options.apply) {
        const result = await db.ebayOrderImport.updateMany({
          where: { id: row.id, updatedAt: row.updatedAt },
          data: { payload: plan.kind === "clear" ? Prisma.DbNull : (plan.payload as Prisma.InputJsonObject) },
        });
        if (result.count === 0) {
          summary.skippedConcurrent++;
          continue;
        }
      }
      if (plan.kind === "clear") summary.cleared++;
      else summary.rewritten++;
    }
    if (rows.length < options.batchSize) break;
  }
  return summary;
}
