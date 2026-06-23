export type UnitSaleStatus = "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";

export interface UnitSalePlanInput {
  quantity: number;
  status: UnitSaleStatus;
}

export interface UnitSalePlan {
  remainingQuantity: number;
  status: UnitSaleStatus;
  closeOpenListings: boolean;
  fullySold: boolean;
}

export function planUnitSale(input: UnitSalePlanInput): UnitSalePlan {
  if (input.status === "SOLD") {
    throw new Error("Stock row is already sold.");
  }

  const quantity = Number.isFinite(input.quantity) ? Math.max(1, Math.floor(input.quantity)) : 1;
  if (quantity <= 1) {
    return {
      remainingQuantity: 1,
      status: "SOLD",
      closeOpenListings: true,
      fullySold: true,
    };
  }

  return {
    remainingQuantity: quantity - 1,
    status: input.status,
    closeOpenListings: false,
    fullySold: false,
  };
}
