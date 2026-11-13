import type { EbayUkFeeProfile } from "./ebayUkFees.js";

/** Seller-type fields for sale shortcuts that search for a buyer total. */
export function saleShortcutFeeOptions(fees: {
  sellerProfile: EbayUkFeeProfile;
  vatOnFees: boolean;
}): { feeProfile: EbayUkFeeProfile; vatOnFees: boolean } {
  return {
    feeProfile: fees.sellerProfile,
    vatOnFees: fees.vatOnFees,
  };
}
