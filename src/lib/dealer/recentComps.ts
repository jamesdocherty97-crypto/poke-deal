export interface RecentCompEntry {
  name: string;
  setName: string;
  number?: string;
  grade: string;
  pricePence: number;
  lowPence: number;
  highPence: number;
  sampleSize: number;
  windowDays: number;
  source: string;
  confidenceLabel: string;
  confidenceTone: string;
  imageUrl?: string;
  setMarkUrl?: string;
  lookedUpAt: string;
}

export const MAX_RECENT_COMPS = 12;

export function pinRecentComp(
  current: readonly RecentCompEntry[],
  entry: RecentCompEntry,
  maxEntries = MAX_RECENT_COMPS,
): RecentCompEntry[] {
  const normalized = normalizeRecentComp(entry);
  if (!normalized) return current.slice(0, maxEntries);
  const key = recentCompKey(normalized);
  const duplicate = current.find((row) => recentCompKey(row) === key);
  const imageUrl = normalized.imageUrl ?? duplicate?.imageUrl;
  const setMarkUrl = normalized.setMarkUrl ?? duplicate?.setMarkUrl;
  const pinned = {
    ...normalized,
    ...(imageUrl ? { imageUrl } : {}),
    ...(setMarkUrl ? { setMarkUrl } : {}),
  };
  const withoutDuplicate = current.filter((row) => recentCompKey(row) !== key);
  return [pinned, ...withoutDuplicate].slice(0, Math.max(1, Math.round(maxEntries)));
}

export function removeRecentComp(current: readonly RecentCompEntry[], entry: RecentCompEntry): RecentCompEntry[] {
  const key = recentCompKey(entry);
  return current.filter((row) => recentCompKey(row) !== key);
}

export function parseRecentComps(value: string | null | undefined, maxEntries = MAX_RECENT_COMPS): RecentCompEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return dedupeRecentComps(parsed, maxEntries);
  } catch {
    return [];
  }
}

export function serializeRecentComps(entries: readonly RecentCompEntry[]): string {
  return JSON.stringify(dedupeRecentComps(entries, MAX_RECENT_COMPS));
}

export function recentCompKey(entry: Pick<RecentCompEntry, "name" | "setName" | "number" | "grade">): string {
  return [
    normalizeRecentCompKeyText(entry.name),
    normalizeRecentCompKeyText(entry.setName),
    normalizeRecentCompKeyText(entry.number ?? ""),
    normalizeRecentCompKeyText(entry.grade),
  ].join("|");
}

function dedupeRecentComps(values: readonly unknown[], maxEntries: number): RecentCompEntry[] {
  const seen = new Set<string>();
  const next: RecentCompEntry[] = [];
  const limit = Math.max(1, Math.round(maxEntries));

  for (const value of values) {
    const entry = normalizeRecentComp(value);
    if (!entry) continue;
    const key = recentCompKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(entry);
    if (next.length >= limit) break;
  }

  return next;
}

function normalizeRecentComp(value: unknown): RecentCompEntry | null {
  const row = value as Partial<RecentCompEntry> | null;
  const name = cleanText(row?.name);
  const setName = cleanText(row?.setName);
  const number = cleanText(row?.number);
  const grade = cleanText(row?.grade);
  const source = cleanText(row?.source) || "unknown";
  const confidenceLabel = cleanText(row?.confidenceLabel) || "Checked";
  const confidenceTone = cleanText(row?.confidenceTone) || "";
  const imageUrl = cleanText(row?.imageUrl);
  const setMarkUrl = cleanText(row?.setMarkUrl);
  const lookedUpAt = cleanText(row?.lookedUpAt) || new Date(0).toISOString();
  const pricePence = cleanPence(row?.pricePence);
  const lowPence = cleanPence(row?.lowPence);
  const highPence = cleanPence(row?.highPence);
  const sampleSize = cleanCount(row?.sampleSize);
  const windowDays = cleanCount(row?.windowDays);

  if (!name || !setName || !grade) return null;

  return {
    name,
    setName,
    ...(number ? { number } : {}),
    grade,
    pricePence,
    lowPence,
    highPence,
    sampleSize,
    windowDays,
    source,
    confidenceLabel,
    confidenceTone,
    ...(imageUrl ? { imageUrl } : {}),
    ...(setMarkUrl ? { setMarkUrl } : {}),
    lookedUpAt,
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeRecentCompKeyText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b1st\s*ed\.?\b/g, "1st edition")
    .replace(/\bfirst\s*edition\b/g, "1st edition")
    .replace(/\s+/g, " ");
}

function cleanPence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function cleanCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
