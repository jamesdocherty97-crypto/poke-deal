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
  candidates: Array<{ imageUrl: string; source: CompCardImageSource; listingSafe: boolean }>;
};

export function resolveCompCardImage(input: {
  catalog?: Pick<CatalogCard, "imageUrl" | "displayImageUrl"> | null;
  headline?: CompResult | null;
  all?: readonly CompResult[];
}): CompCardImageEvidence {
  const candidates: CompCardImageEvidence["candidates"] = [];
  const add = (imageUrl: string | null, source: CompCardImageSource, listingSafe: boolean) => {
    if (imageUrl && !candidates.some((candidate) => candidate.imageUrl === imageUrl)) candidates.push({ imageUrl, source, listingSafe });
  };
  add(cleanUrl(input.catalog?.imageUrl), "catalog", true);
  add(cleanUrl(input.catalog?.displayImageUrl), "cached-display", false);

  for (const result of rankedCompResults(input.headline, input.all ?? [])) {
    const source = result.source === "poketrace" ? "poketrace" : result.source === "pokemon-price-tracker" ? "pokemon-price-tracker" : "none";
    for (const imageUrl of providerImageCandidates(result)) add(imageUrl, source, false);
  }

  const first = candidates[0];
  return {
    imageUrl: first?.imageUrl ?? null,
    source: first?.source ?? "none",
    listingSafe: first?.listingSafe ?? false,
    candidates,
  };
}

export function providerImageFromCompResult(result: CompResult | null | undefined): string | null {
  return providerImageCandidates(result)[0] ?? null;
}

export function providerImageCandidates(result: CompResult | null | undefined): string[] {
  if (!result?.raw || typeof result.raw !== "object") return [];
  const raw = result.raw as Record<string, unknown>;
  const providerCard = isRecord(raw.providerCard) ? raw.providerCard : null;
  return uniqueCleanUrls(
    providerCard?.imageCdnUrl800,
    providerCard?.imageCdnUrl400,
    providerCard?.imageCdnUrl200,
    providerCard?.imageCdnUrl,
    raw.displayImageUrl,
    raw.imageUrl,
    raw.image,
    providerCard?.imageUrl,
    providerCard?.image,
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

function uniqueCleanUrls(...values: unknown[]): string[] {
  const urls: string[] = [];
  for (const value of values) {
    const url = cleanUrl(value);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
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
