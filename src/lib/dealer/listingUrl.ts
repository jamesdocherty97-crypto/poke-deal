export function normalizeListingUrl(value: string | null | undefined): string | null {
  const trimmed = extractListingUrlCandidate(value);
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractListingUrlCandidate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const exactishUrl = cleanupUrlCandidate(trimmed);
  if (exactishUrl && !/\s/.test(exactishUrl)) return exactishUrl;

  const match = trimmed.match(/https?:\/\/[^\s<>"']+|(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s<>"']*)?/i);
  return cleanupUrlCandidate(match?.[0] ?? null);
}

function cleanupUrlCandidate(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/[),.;\]]+$/g, "");
  return cleaned || null;
}

/** Numeric live item reference from a seller-supplied eBay listing link. */
export function ebayListingIdFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(?:(?:www|m)\.)?ebay\.(?:co\.uk|com)$/i.test(url.hostname)) return null;
    const path = url.pathname.match(/^\/itm\/(?:[^/]+\/)?(\d{9,15})(?:\/|$)/i);
    return path?.[1] ?? null;
  } catch { return null; }
}
