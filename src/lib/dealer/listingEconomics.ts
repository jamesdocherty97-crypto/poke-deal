import { buyerSeesPence, type EbayUkFeeProfile } from "./ebayUkFees.js";
import {
  defaultGrossSalePence,
  estimateSaleCosts,
  saleNetPence,
  type SaleChannel,
} from "./saleFees.js";

export interface ListingEconomicsInput {
  channel: SaleChannel;
  grade?: string | null;
  itemPricePence: number;
  costBasisPence: number;
  feeProfile?: EbayUkFeeProfile;
  vatOnFees?: boolean;
}

export interface ListingEconomics {
  grossPence: number;
  feesPence: number;
  postagePence: number;
  netPence: number;
  costPence: number;
  profitPence: number;
  roiPct: number | null;
  marginPct: number | null;
  feeProfile: EbayUkFeeProfile;
  buyerSeesPence?: number;
}

export function buildListingEconomics(input: ListingEconomicsInput): ListingEconomics {
  const itemPricePence = Math.max(0, Math.round(input.itemPricePence));
  const costPence = Math.max(0, Math.round(input.costBasisPence));
  const feeProfile = input.feeProfile ?? "LEGACY_FLAT";
  const vatOnFees = input.vatOnFees ?? true;
  const grossPence = defaultGrossSalePence(input.channel, itemPricePence, { grade: input.grade });
  const costs = estimateSaleCosts(input.channel, grossPence, { grade: input.grade, feeProfile, vatOnFees });
  const netPence = saleNetPence({
    salePricePence: grossPence,
    feesPence: costs.feesPence,
    postagePence: costs.postagePence,
  });
  const profitPence = netPence - costPence;

  return {
    grossPence,
    feesPence: costs.feesPence,
    postagePence: costs.postagePence,
    netPence,
    costPence,
    profitPence,
    roiPct: costPence > 0 ? roundPct(profitPence / costPence) : null,
    marginPct: grossPence > 0 ? roundPct(profitPence / grossPence) : null,
    feeProfile,
    ...(input.channel === "EBAY" && feeProfile === "PRIVATE_UK" ? { buyerSeesPence: buyerSeesPence(itemPricePence) } : {}),
  };
}

function roundPct(value: number): number {
  return Math.round(value * 1000) / 10;
}
