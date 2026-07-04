const PROVIDER_SET_PREFIX_RE = /^[A-Z]{2,4}\d{1,3}:\s*/i;
const PROMO_PREFIX_RE = /^(?:SVP|MEP|SWSH|SM|XY|BW|DP|HGSS)(\d{1,4})$/i;

export function normalizeCollectorNumberForCompare(value: string | null | undefined): string | null {
  const cleaned = value
    ?.trim()
    .toUpperCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, "");
  if (!cleaned) return null;
  const normalized = cleaned
    .split("/")
    .map((part) => stripLeadingZerosFromNumericSegment(part) ?? part)
    .join("/");
  return normalized.length > 0 ? normalized : null;
}

export function collectorNumbersEquivalent(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftForms = collectorNumberCompareForms(left);
  const rightForms = collectorNumberCompareForms(right);
  if (leftForms.size === 0 || rightForms.size === 0) return false;
  return [...leftForms].some((form) => rightForms.has(form));
}

export function collectorNumberCompareForms(value: string | null | undefined): Set<string> {
  const normalized = normalizeCollectorNumberForCompare(value);
  if (!normalized) return new Set();
  const left = normalized.split("/")[0] ?? normalized;
  const promoPrefixless = stripKnownPromoPrefix(left);
  return new Set(
    [
      normalized,
      left,
      promoPrefixless,
      promoPrefixless ? stripLeadingZerosFromNumericSegment(promoPrefixless) : null,
    ].filter((form): form is string => Boolean(form)),
  );
}

export function stripLeadingZerosFromNumericSegment(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  if (!cleaned || !/^\d+$/.test(cleaned)) return null;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? String(parsed) : null;
}

export function stripProviderSetCodePrefix(value: string | null | undefined): string {
  return value?.trim().replace(PROVIDER_SET_PREFIX_RE, "").trim() ?? "";
}

export function normalizeSetNameForCompare(value: string | null | undefined): string {
  return stripProviderSetCodePrefix(value)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripKnownPromoPrefix(value: string): string | null {
  const match = value.match(PROMO_PREFIX_RE);
  return match?.[1] ?? null;
}
