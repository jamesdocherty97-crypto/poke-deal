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
