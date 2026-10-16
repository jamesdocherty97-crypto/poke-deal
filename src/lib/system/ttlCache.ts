/**
 * Memoise one async result for `ttlMs` within an isolate. Concurrent callers
 * share the in-flight load; a rejected load is not cached.
 */
export function createTtlCache<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now) {
  let entry: { value: T; expiresAt: number } | null = null;
  let inflight: Promise<T> | null = null;

  return async function read(): Promise<{ value: T; hit: boolean; expiresAt: number }> {
    if (entry && entry.expiresAt > now()) return { ...entry, hit: true };
    if (!inflight) {
      inflight = load()
        .then((value) => {
          entry = { value, expiresAt: now() + ttlMs };
          return value;
        })
        .finally(() => { inflight = null; });
    }
    await inflight;
    return { ...entry!, hit: false };
  };
}
