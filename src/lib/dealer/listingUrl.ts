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
