type SourceSuccessRegistry = Map<string, number>;

const globalRegistry = globalThis as typeof globalThis & { __pokeDealSourceSuccess?: SourceSuccessRegistry };
const registry = globalRegistry.__pokeDealSourceSuccess ?? new Map<string, number>();
globalRegistry.__pokeDealSourceSuccess = registry;

export function recordSourceSuccess(id: string, at = new Date()): void {
  registry.set(id, at.getTime());
}

export function readSourceFreshness(id: string, now = new Date()): {
  lastSuccessAt: string | null;
  freshnessSeconds: number | null;
} {
  const value = registry.get(id);
  if (value === undefined) return { lastSuccessAt: null, freshnessSeconds: null };
  return {
    lastSuccessAt: new Date(value).toISOString(),
    freshnessSeconds: Math.max(0, Math.floor((now.getTime() - value) / 1_000)),
  };
}

export function resetSourceFreshnessForTests(): void {
  registry.clear();
}
