import { formatGbp } from "../format/money.js";

export type ListingPhotoOrigin = "REAL" | "SCAN" | "CATALOG";

export interface ListingPhoto {
  id?: string;
  url?: string | null;
  origin?: ListingPhotoOrigin | null;
  order?: number | null;
  createdAt?: Date | string | null;
}

export interface ListingPhotoSummary {
  orderedPhotos: ListingPhoto[];
  imageUrls: string[];
  hasRealPhoto: boolean;
  hasCatalogPhoto: boolean;
  catalogOnly: boolean;
  catalogPhotoAllowed: boolean;
  satisfiesEbayPhotoRequirement: boolean;
  requiresRealPhoto: boolean;
  catalogPhotoMaxPricePence: number;
}

export const DEFAULT_CATALOG_PHOTO_MAX_PRICE_PENCE = 2000;
export const STOCK_IMAGE_DISCLOSURE =
  "Stock image shown — you will receive the card pictured in the title, in the condition stated.";

export function readCatalogPhotoMaxPricePence(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): number {
  const explicitPence = parsePositiveInt(env.CATALOG_PHOTO_MAX_PRICE_PENCE);
  if (explicitPence != null) return explicitPence;

  const explicitGbp = parsePositiveNumber(env.CATALOG_PHOTO_MAX_PRICE_GBP);
  if (explicitGbp != null) return Math.round(explicitGbp * 100);

  return DEFAULT_CATALOG_PHOTO_MAX_PRICE_PENCE;
}

export function isCatalogPhotoEligible(input: {
  grade: string;
  pricePence: number | null | undefined;
  catalogPhotoMaxPricePence?: number;
}): boolean {
  const threshold = input.catalogPhotoMaxPricePence ?? DEFAULT_CATALOG_PHOTO_MAX_PRICE_PENCE;
  const price = Number.isFinite(input.pricePence) ? Math.round(input.pricePence ?? 0) : 0;
  return input.grade === "RAW" && price > 0 && price < threshold;
}

export function orderListingPhotos<T extends ListingPhoto>(photos: readonly T[]): T[] {
  return photos
    .map((photo, index) => ({ photo, index }))
    .sort((a, b) => {
      const originA = photoOriginRank(a.photo);
      const originB = photoOriginRank(b.photo);
      if (originA !== originB) return originA - originB;

      const orderA = Number.isFinite(a.photo.order) ? Number(a.photo.order) : a.index;
      const orderB = Number.isFinite(b.photo.order) ? Number(b.photo.order) : b.index;
      if (orderA !== orderB) return orderA - orderB;
      return a.index - b.index;
    })
    .map((entry) => entry.photo);
}

export function summarizeListingPhotos(input: {
  photos: readonly ListingPhoto[];
  grade: string;
  pricePence: number | null | undefined;
  catalogPhotoMaxPricePence?: number;
}): ListingPhotoSummary {
  const threshold = input.catalogPhotoMaxPricePence ?? readCatalogPhotoMaxPricePence();
  const orderedPhotos = orderListingPhotos(input.photos).filter((photo) => Boolean(photo.url?.trim()));
  const hasRealPhoto = orderedPhotos.some((photo) => (photo.origin ?? "REAL") !== "CATALOG");
  const hasCatalogPhoto = orderedPhotos.some((photo) => photo.origin === "CATALOG");
  const catalogOnly = hasCatalogPhoto && !hasRealPhoto;
  const catalogPhotoAllowed = isCatalogPhotoEligible({
    grade: input.grade,
    pricePence: input.pricePence,
    catalogPhotoMaxPricePence: threshold,
  });
  const satisfiesEbayPhotoRequirement = hasRealPhoto || (catalogOnly && catalogPhotoAllowed);

  return {
    orderedPhotos,
    imageUrls: orderedPhotos.map((photo) => photo.url!.trim()).slice(0, 12),
    hasRealPhoto,
    hasCatalogPhoto,
    catalogOnly,
    catalogPhotoAllowed,
    satisfiesEbayPhotoRequirement,
    requiresRealPhoto: !satisfiesEbayPhotoRequirement,
    catalogPhotoMaxPricePence: threshold,
  };
}

export function photoRequirementMessage(summary: ListingPhotoSummary): string {
  const threshold = formatGbp(summary.catalogPhotoMaxPricePence);
  if (!summary.hasRealPhoto && summary.hasCatalogPhoto && !summary.catalogPhotoAllowed) {
    return `Add photos from the Stock/List row. Real photos are required for graded cards and eBay listings at ${threshold} or above.`;
  }
  if (!summary.hasRealPhoto && summary.catalogPhotoAllowed) {
    return `Add photos from the Stock/List row, or tap Use catalog art in the photo tools for raw eBay listings under ${threshold}.`;
  }
  return `Add photos from the Stock/List row. Real photos are required for graded cards and eBay listings at ${threshold} or above.`;
}

function photoOriginRank(photo: ListingPhoto): number {
  return (photo.origin ?? "REAL") === "CATALOG" ? 1 : 0;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
