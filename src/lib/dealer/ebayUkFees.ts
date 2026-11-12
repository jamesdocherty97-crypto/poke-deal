export type EbayUkFeeProfile = "LEGACY_FLAT" | "PRIVATE_UK" | "BUSINESS_UK";

/** Date the published eBay UK help pages below were read. */
export const RATES_CHECKED = "2026-11-12";

/** Toys & Games and Collectables final value fee, percent of the order total. */
export const BUSINESS_FINAL_VALUE_FEE_PCT = 10.9;
/** Regulatory operating fee, percent, charged with the final value fee. */
export const REGULATORY_OPERATING_FEE_PCT = 0.35;
/** Per-order fee in pence when the order total is £10.00 or less. */
export const PER_ORDER_FEE_UP_TO_1000_PENCE = 30;
/** Per-order fee in pence when the order total is above £10.00. */
export const PER_ORDER_FEE_ABOVE_1000_PENCE = 40;
/** VAT percent added to eBay fees when the seller is not VAT registered. */
export const VAT_ON_FEES_PCT = 20;

export const EBAY_UK_PRIVATE_SELLER_FEES_URL =
  "https://www.ebay.co.uk/help/selling/fees-credits-invoices/selling-fees-private-sellers?id=4822";
export const EBAY_UK_BUSINESS_SELLER_FEES_URL =
  "https://www.ebay.co.uk/help/selling/fees-credits-invoices/selling-fees?id=4809";
export const EBAY_UK_BUYER_PROTECTION_URL =
  "https://www.ebay.co.uk/help/buying/paying-items/buyer-protection?id=5595";

export const EBAY_UK_FEE_SOURCE_URLS = [
  EBAY_UK_PRIVATE_SELLER_FEES_URL,
  EBAY_UK_BUSINESS_SELLER_FEES_URL,
  EBAY_UK_BUYER_PROTECTION_URL,
] as const;

const FEE_PROFILES: readonly EbayUkFeeProfile[] = ["LEGACY_FLAT", "PRIVATE_UK", "BUSINESS_UK"];

export function isEbayUkFeeProfile(value: unknown): value is EbayUkFeeProfile {
  return FEE_PROFILES.includes(value as EbayUkFeeProfile);
}

export function ebayUkSellerFeesPence({
  profile,
  orderTotalPence,
  vatOnFees = true,
}: {
  profile: EbayUkFeeProfile;
  orderTotalPence: number;
  vatOnFees?: boolean;
}): number {
  const t = orderTotalPence;
  if (profile === "PRIVATE_UK") return 0;
  if (profile === "LEGACY_FLAT") return Math.round(t * 0.128) + (t > 0 ? 30 : 0);
  if (t <= 0) return 0;
  const perOrder = t <= 1000 ? PER_ORDER_FEE_UP_TO_1000_PENCE : PER_ORDER_FEE_ABOVE_1000_PENCE;
  return Math.round((t * 1125 + perOrder * 10000) * (vatOnFees ? 12 : 10) / 100000);
}

export function buyerProtectionFeePence(itemPricePence: number): number {
  const p = itemPricePence;
  if (p <= 0) return 0;
  const upTo20 = Math.min(p, 2000);
  const from20To300 = Math.max(0, Math.min(p, 30000) - 2000);
  const from300To4000 = Math.max(0, Math.min(p, 400000) - 30000);
  return Math.round(10 + (700 * upTo20 + 400 * from20To300 + 200 * from300To4000) / 10000);
}

export function buyerSeesPence(itemPricePence: number): number {
  if (itemPricePence <= 0) return 0;
  return itemPricePence + buyerProtectionFeePence(itemPricePence);
}

/** Largest item price whose buyer-visible price is at or below the target. */
export function privateItemPriceForBuyerVisiblePence(displayedPence: number): number {
  const target = Math.floor(displayedPence);
  if (target <= 0) return 0;
  let low = 0;
  let high = target;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (buyerSeesPence(mid) <= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function feeProfileLabel(profile: EbayUkFeeProfile): string {
  if (profile === "PRIVATE_UK") return "UK private seller";
  if (profile === "BUSINESS_UK") return "UK business seller";
  return "Old flat 12.8% + 30p";
}
