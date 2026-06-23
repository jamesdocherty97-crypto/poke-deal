export const RECENT_SET_LIMIT = 12;

export function parseRecentSetIds(value: string | null | undefined, limit = RECENT_SET_LIMIT): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? normalizeSetIds(parsed, limit) : [];
  } catch {
    return [];
  }
}

export function pinRecentSetId(current: readonly string[], id: string | null | undefined, limit = RECENT_SET_LIMIT): string[] {
  const normalized = normalizeSetId(id);
  if (!normalized) return normalizeSetIds(current, limit);
  return normalizeSetIds([normalized, ...current], limit);
}

function normalizeSetIds(values: readonly unknown[], limit: number): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  const safeLimit = Math.max(1, Math.round(limit));

  for (const value of values) {
    const id = normalizeSetId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
    if (next.length >= safeLimit) break;
  }

  return next;
}

function normalizeSetId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
