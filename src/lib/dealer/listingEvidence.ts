import type { CardPriceHistoryPreview } from "../comps/priceHistory.js";
import { isGenuineSoldCompSource } from "../comps/priceHistory.js";
import type { ListingPackInput } from "./listingPack.js";

export type ListingEvidenceFields = Pick<ListingPackInput, "compMedianPence" | "soldEvidence">;

/**
 * The only bridge from internal market history to buyer-facing listing claims.
 * Returning an empty object keeps both the price and receipt out when any
 * evidence field is incomplete or the source is not explicitly sold-based.
 */
export function listingEvidenceFromPreview(
  preview: CardPriceHistoryPreview | null | undefined,
): ListingEvidenceFields | Record<string, never> {
  const evidence = preview?.soldEvidence;
  if (!evidence || !isGenuineSoldCompSource(evidence.source)) return {};
  if (!Number.isInteger(evidence.medianPence) || evidence.medianPence <= 0) return {};
  if (!Number.isInteger(evidence.sampleSize) || evidence.sampleSize <= 0) return {};
  if (!Number.isInteger(evidence.windowDays) || evidence.windowDays <= 0) return {};
  const asOf = new Date(evidence.asOf);
  if (!Number.isFinite(asOf.getTime())) return {};
  return {
    compMedianPence: evidence.medianPence,
    soldEvidence: {
      sampleSize: evidence.sampleSize,
      windowDays: evidence.windowDays,
      compAsOf: asOf.toISOString(),
      ...(evidence.sourceRegion ? { sourceRegion: evidence.sourceRegion } : {}),
    },
  };
}
