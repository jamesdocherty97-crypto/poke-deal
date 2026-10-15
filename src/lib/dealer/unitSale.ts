export type UnitSaleStatus = "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";

export interface UnitSalePlanInput {
  quantity: number;
  status: UnitSaleStatus;
  soldQuantity?: number;
}

export interface UnitSalePlan {
  soldQuantity: number;
  remainingQuantity: number;
  status: UnitSaleStatus;
  closeOpenListings: boolean;
  fullySold: boolean;
}

export interface UnitSaleUndoInput {
  quantity: number;
  status: UnitSaleStatus;
}

export interface UnitSaleUndoPlan {
  quantity: number;
  status: UnitSaleStatus;
  restoredQuantity: number;
}

export interface SalePreviewInput {
  salePricePence: number;
  feesPence: number;
  postagePence: number;
  unitCostPence: number;
  soldQuantity: number;
}

export interface SalePreview {
  soldQuantity: number;
  netPence: number;
  costPence: number;
  profitPence: number;
  roiPct: number | null;
  marginPct: number | null;
}

export function planUnitSale(input: UnitSalePlanInput): UnitSalePlan {
  if (input.status === "SOLD") {
    throw new Error("Stock row is already sold.");
  }

  const quantity = Number.isFinite(input.quantity) ? Math.max(1, Math.floor(input.quantity)) : 1;
  const soldQuantity = input.soldQuantity == null ? 1 : Math.floor(input.soldQuantity);
  if (!Number.isFinite(soldQuantity) || soldQuantity <= 0) {
    throw new Error("Sold quantity must be a whole number above 0.");
  }
  if (soldQuantity > quantity) {
    throw new Error("Sold quantity cannot exceed stock quantity.");
  }

  const remainingQuantity = quantity - soldQuantity;
  if (remainingQuantity <= 0) {
    return {
      soldQuantity,
      remainingQuantity: quantity,
      status: "SOLD",
      closeOpenListings: true,
      fullySold: true,
    };
  }

  return {
    soldQuantity,
    remainingQuantity,
    status: input.status,
    closeOpenListings: false,
    fullySold: false,
  };
}

export function planSaleUndo(input: UnitSaleUndoInput): UnitSaleUndoPlan {
  const quantity = Number.isFinite(input.quantity) ? Math.max(1, Math.floor(input.quantity)) : 1;
  if (input.status === "SOLD") {
    return {
      quantity: 1,
      status: "IN_STOCK",
      restoredQuantity: 1,
    };
  }

  return {
    quantity: quantity + 1,
    status: input.status,
    restoredQuantity: 1,
  };
}

export function splitPence(totalPence: number, parts: number): number[] {
  const count = Math.max(1, Math.floor(parts));
  const total = Math.max(0, Math.round(totalPence));
  const base = Math.floor(total / count);
  let remainder = total % count;
  return Array.from({ length: count }, () => {
    const value = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return value;
  });
}

/**
 * Split total pence in proportion to weights by largest remainder, so the parts
 * always sum to exactly the total. With no positive weight it splits evenly.
 */
export function allocatePence(totalPence: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const total = Math.max(0, Math.round(totalPence));
  const clean = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? Math.round(weight) : 0));
  const weightSum = clean.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) return splitPence(total, weights.length);
  const bigTotal = BigInt(total);
  const bigSum = BigInt(weightSum);
  const parts = clean.map((weight) => Number((bigTotal * BigInt(weight)) / bigSum));
  const order = clean
    .map((weight, index) => ({ index, remainder: (bigTotal * BigInt(weight)) % bigSum }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  let left = total - parts.reduce((sum, part) => sum + part, 0);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

export function buildSalePreview(input: SalePreviewInput): SalePreview {
  const soldQuantity = Math.max(1, Math.floor(input.soldQuantity));
  const salePricePence = Math.max(0, Math.round(input.salePricePence));
  const feesPence = Math.max(0, Math.round(input.feesPence));
  const postagePence = Math.max(0, Math.round(input.postagePence));
  const unitCostPence = Math.max(0, Math.round(input.unitCostPence));
  const netPence = salePricePence - feesPence - postagePence;
  const costPence = unitCostPence * soldQuantity;
  const profitPence = netPence - costPence;

  return {
    soldQuantity,
    netPence,
    costPence,
    profitPence,
    roiPct: costPence > 0 ? roundPct(profitPence / costPence) : null,
    marginPct: salePricePence > 0 ? roundPct(profitPence / salePricePence) : null,
  };
}

function roundPct(value: number): number {
  return Math.round(value * 1000) / 10;
}
