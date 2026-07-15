export type ListingDraftGrade = string;

export interface ListingDraftCard {
  name: string;
  setName?: string | null;
  number?: string | null;
  language?: string | null;
}

export interface ListingDraftItem {
  card: ListingDraftCard;
  grade: ListingDraftGrade;
  costBasis: number;
}

export function buildListingTitle(
  card: ListingDraftCard,
  grade: ListingDraftGrade,
  condition?: string | null,
): string {
  return buildEbayTitle({ card, grade, condition: condition ?? undefined });
}

export function defaultManualListPricePence(costBasisPence: number, minMargin = 0.35): number {
  if (!Number.isFinite(costBasisPence) || costBasisPence <= 0) return 0;
  const margin = Number.isFinite(minMargin) && minMargin >= 0 ? minMargin : 0.35;
  return Math.round(costBasisPence * (1 + margin));
}

export function buildListingDraftDefaults(item: ListingDraftItem): {
  title: string;
  listPricePence: number;
} {
  return {
    title: buildListingTitle(item.card, item.grade),
    listPricePence: defaultManualListPricePence(item.costBasis),
  };
}
import { buildEbayTitle } from "./listingPack.js";
