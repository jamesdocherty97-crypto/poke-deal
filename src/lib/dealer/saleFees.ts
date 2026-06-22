export type SaleChannel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";

export interface SaleCostEstimate {
  feesPence: number;
  postagePence: number;
}

export function estimateSaleCosts(channel: SaleChannel, salePricePence: number): SaleCostEstimate {
  const price = Math.max(0, Math.round(salePricePence));

  if (channel === "EBAY") {
    return {
      feesPence: Math.round(price * 0.128) + (price > 0 ? 30 : 0),
      postagePence: 120,
    };
  }

  if (channel === "CARDMARKET") {
    return {
      feesPence: Math.round(price * 0.05),
      postagePence: 120,
    };
  }

  return {
    feesPence: 0,
    postagePence: 0,
  };
}

export function saleNetPence({
  salePricePence,
  feesPence,
  postagePence,
}: {
  salePricePence: number;
  feesPence: number;
  postagePence: number;
}): number {
  return salePricePence - feesPence - postagePence;
}
