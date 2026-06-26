export interface SplitTotalCostResult {
  unitCostPence: number;
  representedTotalPence: number;
  roundingDeltaPence: number;
}

export function splitTotalCostToUnitPence(totalCostPence: number, quantity: number): SplitTotalCostResult | null {
  const total = Math.max(0, Math.round(totalCostPence));
  const qty = Math.floor(quantity);
  if (total <= 0 || !Number.isFinite(qty) || qty <= 0) return null;

  const unitCostPence = Math.round(total / qty);
  const representedTotalPence = unitCostPence * qty;

  return {
    unitCostPence,
    representedTotalPence,
    roundingDeltaPence: representedTotalPence - total,
  };
}
