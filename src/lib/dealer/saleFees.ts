export type SaleChannel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";

export interface SaleCostEstimate {
  feesPence: number;
  postagePence: number;
}

export interface SaleCostOptions {
  grade?: string | null;
}

export interface SalePriceBreakdown {
  grossPence: number;
  itemSubtotalPence: number;
  postagePaidPence: number;
  unitItemPence: number;
  quantity: number;
}

const RAW_POSTAGE_PENCE = 175;
const GRADED_POSTAGE_PENCE = 499;

export function estimateSaleCosts(
  channel: SaleChannel,
  salePricePence: number,
  options: SaleCostOptions = {},
): SaleCostEstimate {
  const price = Math.max(0, Math.round(salePricePence));

  if (channel === "EBAY") {
    return {
      feesPence: Math.round(price * 0.128) + (price > 0 ? 30 : 0),
      postagePence: postedSalePostagePence(options.grade),
    };
  }

  if (channel === "CARDMARKET") {
    return {
      feesPence: Math.round(price * 0.05),
      postagePence: postedSalePostagePence(options.grade),
    };
  }

  return {
    feesPence: 0,
    postagePence: 0,
  };
}

export function postedSalePostagePence(grade: string | null | undefined): number {
  return isGradedSaleGrade(grade) ? GRADED_POSTAGE_PENCE : RAW_POSTAGE_PENCE;
}

export function buyerPaidPostagePence(channel: SaleChannel, grade: string | null | undefined): number {
  if (channel === "EBAY" || channel === "CARDMARKET") return postedSalePostagePence(grade);
  return 0;
}

export function defaultGrossSalePence(
  channel: SaleChannel,
  itemPricePence: number,
  options: SaleCostOptions = {},
): number {
  const itemPrice = Math.max(0, Math.round(itemPricePence));
  return itemPrice + buyerPaidPostagePence(channel, options.grade);
}

export function saleItemSubtotalPence(
  channel: SaleChannel,
  grossSalePence: number,
  options: SaleCostOptions = {},
): number {
  const gross = Math.max(0, Math.round(grossSalePence));
  return Math.max(0, gross - buyerPaidPostagePence(channel, options.grade));
}

export function salePriceBreakdown(
  channel: SaleChannel,
  grossSalePence: number,
  quantity: number,
  options: SaleCostOptions = {},
): SalePriceBreakdown {
  const count = Math.max(1, Math.floor(quantity));
  const grossPence = Math.max(0, Math.round(grossSalePence));
  const postagePaidPence = Math.min(grossPence, buyerPaidPostagePence(channel, options.grade));
  const itemSubtotalPence = saleItemSubtotalPence(channel, grossPence, options);
  return {
    grossPence,
    itemSubtotalPence,
    postagePaidPence,
    unitItemPence: Math.round(itemSubtotalPence / count),
    quantity: count,
  };
}

export function rescaleGrossSaleForQuantity(
  channel: SaleChannel,
  grossSalePence: number,
  fromQuantity: number,
  toQuantity: number,
  options: SaleCostOptions = {},
): number {
  const from = Math.max(1, Math.floor(fromQuantity));
  const to = Math.max(1, Math.floor(toQuantity));
  const itemSubtotal = saleItemSubtotalPence(channel, grossSalePence, options);
  const unitSubtotal = Math.round(itemSubtotal / from);
  return defaultGrossSalePence(channel, unitSubtotal * to, options);
}

export function discountedItemSubtotalPence(
  unitItemPricePence: number,
  discountPerUnitPence: number,
  quantity = 1,
): number {
  const unitPrice = Math.max(0, Math.round(unitItemPricePence));
  const discount = Math.max(0, Math.round(discountPerUnitPence));
  const count = Math.max(1, Math.floor(quantity));
  return Math.max(0, unitPrice - discount) * count;
}

export function acceptedOfferItemSubtotalPence(
  unitItemPricePence: number,
  offerPct: number,
  quantity = 1,
): number {
  const unitPrice = Math.max(0, Math.round(unitItemPricePence));
  const pct = Math.max(0, Math.min(1, offerPct));
  const count = Math.max(1, Math.floor(quantity));
  return Math.round(unitPrice * pct) * count;
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

export function grossSalePriceForNetPence(
  channel: SaleChannel,
  netPence: number,
  options: SaleCostOptions = {},
): number {
  const target = Math.max(0, Math.round(netPence));
  if (target <= 0) return 0;
  if (channel === "IN_PERSON" || channel === "VINTED") return target;

  let price = target;
  const maxPrice = target * 3 + 5000;
  while (price <= maxPrice) {
    const costs = estimateSaleCosts(channel, price, options);
    if (saleNetPence({ salePricePence: price, feesPence: costs.feesPence, postagePence: costs.postagePence }) >= target) {
      return price;
    }
    price += 1;
  }

  return maxPrice;
}

export function breakEvenSalePricePence(
  channel: SaleChannel,
  costPence: number,
  options: SaleCostOptions = {},
): number {
  const target = Math.max(0, Math.round(costPence));
  if (target <= 0) return 0;

  let price = target;
  const maxPrice = target * 3 + 5000;
  while (price <= maxPrice) {
    const costs = estimateSaleCosts(channel, price, options);
    if (saleNetPence({ salePricePence: price, feesPence: costs.feesPence, postagePence: costs.postagePence }) >= target) {
      return price;
    }
    price += 1;
  }

  return maxPrice;
}

function isGradedSaleGrade(grade: string | null | undefined): boolean {
  const normalized = grade?.trim().toUpperCase();
  return Boolean(normalized && normalized !== "RAW");
}
