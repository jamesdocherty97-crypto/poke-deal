export const OFFLINE_COMP_FRESH_MS = 6 * 60 * 60 * 1_000;
export const OFFLINE_COMP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const OFFLINE_RETRY_MAX_MS = 15 * 60 * 1_000;

export type OfflineCacheFreshness = "fresh" | "stale" | "expired";

export type CompCacheIdentity = {
  name: string;
  setName?: string;
  number?: string;
  grade: string;
  tcgApiId?: string;
  tcgDexId?: string;
  scanFingerprint?: string;
};

export function canonicalCompCacheKey(identity: CompCacheIdentity): string {
  const lockedId = normalize(identity.tcgApiId) || normalize(identity.tcgDexId);
  const card = lockedId || [normalize(identity.name), normalize(identity.setName), normalize(identity.number)].join(":");
  const fingerprint = normalize(identity.scanFingerprint);
  return [card, normalize(identity.grade) || "raw", fingerprint].filter(Boolean).join("|");
}

export function compCacheFreshness(
  cachedAt: string | number | Date,
  now: string | number | Date = Date.now(),
  options: { freshMs?: number; maxAgeMs?: number } = {},
): { state: OfflineCacheFreshness; ageMs: number; ageHours: number } {
  const cachedMs = toEpoch(cachedAt);
  const nowMs = toEpoch(now);
  const ageMs = Number.isFinite(cachedMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - cachedMs) : Number.POSITIVE_INFINITY;
  const freshMs = options.freshMs ?? OFFLINE_COMP_FRESH_MS;
  const maxAgeMs = options.maxAgeMs ?? OFFLINE_COMP_MAX_AGE_MS;
  return {
    state: ageMs <= freshMs ? "fresh" : ageMs <= maxAgeMs ? "stale" : "expired",
    ageMs,
    ageHours: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / (60 * 60 * 1_000))) : Number.POSITIVE_INFINITY,
  };
}

export function offlineRetryDelayMs(attempts: number): number {
  const safeAttempts = Math.max(0, Math.floor(attempts));
  return Math.min(1_000 * 2 ** safeAttempts, OFFLINE_RETRY_MAX_MS);
}

export function shouldRetryOfflineResponse(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isDueOfflineMutation(
  mutation: { nextAttemptAt?: string | null },
  now: string | number | Date = Date.now(),
): boolean {
  if (!mutation.nextAttemptAt) return true;
  return toEpoch(mutation.nextAttemptAt) <= toEpoch(now);
}

function normalize(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toEpoch(value: string | number | Date): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}
