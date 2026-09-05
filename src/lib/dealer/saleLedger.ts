import { z } from "zod";

// Prisma Int / PostgreSQL INTEGER bounds. Never let coercion turn blank fields
// into an apparently confirmed zero in the financial amendment endpoint.
const pence = z.number().int().min(0).max(2_147_483_647);

export function parseConfirmedPounds(value: string, label: string): number {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(`${label}: enter pounds with up to two decimal places, including 0 for none.`);
  const [pounds, fraction = ""] = text.split(".");
  const amount = Number(pounds) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount > 2_147_483_647) throw new Error(`${label}: amount is too large.`);
  return amount;
}

export const saleAmountsPatchSchema = z.object({
  feesPence: pence,
  postagePence: pence,
  costBasisPence: pence.optional(),
  itemRevenuePence: pence.nullable().optional(),
  reason: z.string().trim().min(3).max(500),
}).strict();

export type SaleAmounts = {
  salePrice: number;
  fees: number;
  postage: number;
  costBasis?: number | null;
  itemRevenue?: number | null;
  costsEstimated?: boolean | null;
  amountRevisions?: unknown;
  clientMutationId?: string | null;
  ebayOrderImport?: unknown;
};

export function saleLedgerEvidence(sale: SaleAmounts, currentInventoryCost: number) {
  return {
    costBasisPence: sale.costBasis ?? currentInventoryCost,
    costBasisEstimated: sale.costBasis == null,
    costsEstimated: sale.costsEstimated !== false,
    itemRevenuePence: sale.itemRevenue ?? null,
    amountRevisionCount: Array.isArray(sale.amountRevisions) ? sale.amountRevisions.length : 0,
    undoable: canUndoSale(sale),
  };
}

export function canUndoSale(sale: SaleAmounts): boolean {
  return sale.costBasis != null && !sale.ebayOrderImport && !sale.clientMutationId?.startsWith("ebay-order:") &&
    !(Array.isArray(sale.amountRevisions) && sale.amountRevisions.length > 0);
}

export function planSaleAmountRevision(
  sale: SaleAmounts,
  patch: z.infer<typeof saleAmountsPatchSchema>,
  now = new Date(),
) {
  const parsed = saleAmountsPatchSchema.parse(patch);
  const before = {
    fees: sale.fees,
    postage: sale.postage,
    costBasis: sale.costBasis ?? null,
    itemRevenue: sale.itemRevenue ?? null,
    costsEstimated: sale.costsEstimated ?? null,
  };
  const after = {
    fees: parsed.feesPence,
    postage: parsed.postagePence,
    costBasis: parsed.costBasisPence ?? before.costBasis,
    itemRevenue: parsed.itemRevenuePence === undefined ? before.itemRevenue : parsed.itemRevenuePence,
    costsEstimated: false,
  };
  if (after.itemRevenue != null && after.itemRevenue > sale.salePrice) {
    throw new Error("Item revenue cannot exceed the recorded buyer payment.");
  }
  // Repeating a successful save is harmless and does not add duplicate history.
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  const history = Array.isArray(sale.amountRevisions) ? sale.amountRevisions : [];
  return {
    ...after,
    amountRevisions: [...history, { changedAt: now.toISOString(), reason: parsed.reason, before, after }],
  };
}

export function exactItemRevenue(salePrice: number, buyerPostage?: number): number | null {
  if (buyerPostage === undefined) return null;
  pence.parse(salePrice);
  pence.parse(buyerPostage);
  if (buyerPostage > salePrice) throw new Error("Buyer-paid postage cannot exceed the buyer payment.");
  return salePrice - buyerPostage;
}

export function inventoryLedgerGuard(input: {
  saleCount: number;
  legacySaleCount?: number;
  deleting?: boolean;
  changingCost?: boolean;
  changingIdentity?: boolean;
  exposedListingCount?: number;
  changingSoldStatus?: boolean;
  changingSoldQuantity?: boolean;
}): string | null {
  if (input.deleting && input.saleCount > 0) return "Stock with recorded sales cannot be deleted. Its sales and profit history must be retained.";
  if (input.deleting && (input.exposedListingCount ?? 0) > 0) return "End and confirm removal of external listings before deleting this stock.";
  if (input.changingCost && (input.legacySaleCount ?? 0) > 0) return "Confirm the historical acquisition cost on existing sales in Profit before changing this stock cost.";
  if (input.changingIdentity && input.saleCount > 0) return "Condition and certificate cannot change after a sale. Record a separate stock row for a different physical copy.";
  if (input.changingSoldStatus || input.changingSoldQuantity) return "Use Record sale or Undo recording mistake to change sold stock. Editing stock cannot create or reverse a sale.";
  return null;
}
