export type CheckedCompConflictResponse = {
  status: 409;
  body: { error: string; code: "duplicate-listing" };
};

/**
 * Translate only the checked-comp listing constraint into the public 409.
 * Other P2002 errors (for example a catalog provider-ID collision) must stay
 * visible as server errors instead of being mislabeled as duplicate evidence.
 */
export function checkedCompConflictResponse(error: unknown): CheckedCompConflictResponse | null {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return null;
  const meta = "meta" in error && error.meta && typeof error.meta === "object"
    ? error.meta as { target?: unknown }
    : null;
  const targets = Array.isArray(meta?.target)
    ? meta.target.filter((value): value is string => typeof value === "string")
    : typeof meta?.target === "string"
      ? [meta.target]
      : [];
  if (!targets.some((target) => target.includes("sourceListingId") || target.includes("CheckedComp_sourceListingId_key"))) {
    return null;
  }
  return {
    status: 409,
    body: {
      error: "That sold listing is already logged. Each active eBay item can back the comp only once. If the existing entry is wrong, void it first, then log corrected evidence.",
      code: "duplicate-listing",
    },
  };
}
