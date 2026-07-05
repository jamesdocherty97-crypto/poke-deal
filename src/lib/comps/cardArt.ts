import type { CatalogCard } from "../catalog/types.js";
import type { CompResult } from "../domain/types.js";

export type CompCardImageSource =
  | "catalog"
  | "cached-display"
  | "poketrace"
  | "pokemon-price-tracker"
  | "none";

export type CompCardImageEvidence = {
  imageUrl: string | null;
  source: CompCardImageSource;
  /** True only for listing-safe catalog artwork. Provider CDN fallbacks are app-display-only. */
  listingSafe: boolean;
};

export function resolveCompCardImage(input: {
  catalog?: Pick<CatalogCard, "imageUrl" | "displayImageUrl"> | null;
  headline?: CompResult | null;
  all?: readonly CompResult[];
}): CompCardImageEvidence {
  const catalogUrl = cleanUrl(input.catalog?.imageUrl);
  if (catalogUrl) return { imageUrl: catalogUrl, source: "catalog", listingSafe: true };

  const cachedDisplayUrl = cleanUrl(input.catalog?.displayImageUrl);
  if (cachedDisplayUrl) return { imageUrl: cachedDisplayUrl, source: "cached-display", listingSafe: false };

  for (const result of rankedCompResults(input.headline, input.all ?? [])) {
    const imageUrl = providerImageFromCompResult(result);
    if (!imageUrl) continue;
    return {
      imageUrl,
      source: result.source === "poketrace" ? "poketrace" : result.source === "pokemon-price-tracker" ? "pokemon-price-tracker" : "none",
      listingSafe: false,
    };
  }

  return { imageUrl: null, source: "none", listingSafe: false };
}

export function providerImageFromCompResult(result: CompResult | null | undefined): string | null {
  if (!result?.raw || typeof result.raw !== "object") return null;
  const raw = result.raw as Record<string, unknown>;
  const providerCard = isRecord(raw.providerCard) ? raw.providerCard : null;
  return firstCleanUrl(
    raw.displayImageUrl,
    raw.imageUrl,
    raw.image,
    providerCard?.imageUrl,
    providerCard?.image,
    providerCard?.imageCdnUrl800,
    providerCard?.imageCdnUrl400,
    providerCard?.imageCdnUrl200,
    providerCard?.imageCdnUrl,
  );
}

function rankedCompResults(headline: CompResult | null | undefined, all: readonly CompResult[]): CompResult[] {
  const rows: CompResult[] = [];
  const seen = new Set<string>();
  for (const result of [headline, ...all]) {
    if (!result) continue;
    const key = `${result.source}|${result.grade}|${result.asOf}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(result);
  }
  return rows.sort((a, b) => imageSourceRank(a.source) - imageSourceRank(b.source));
}

function imageSourceRank(source: string): number {
  if (source === "poketrace") return 0;
  if (source === "pokemon-price-tracker") return 1;
  return 2;
}

function firstCleanUrl(...values: unknown[]): string | null {
  for (const value of values) {
    const url = cleanUrl(value);
    if (url) return url;
  }
  return null;
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
