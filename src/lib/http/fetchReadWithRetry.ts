export type ReadRetryOptions = {
  retries?: number;
  totalDeadlineMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/** One bounded retry for idempotent reads. Writes and caller aborts are never retried. */
export async function fetchReadWithRetry(
  fetchImpl: typeof fetch,
  input: string | URL | Request,
  init: RequestInit = {},
  options: ReadRetryOptions = {},
): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET") return fetchImpl(input, init);
  const retries = Math.max(0, Math.min(2, options.retries ?? 1));
  const deadlineMs = Math.max(1, options.totalDeadlineMs ?? 8_000);
  const maxBackoffMs = Math.max(0, options.maxBackoffMs ?? 1_250);
  const jitterMs = Math.max(0, options.jitterMs ?? 100);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? waitWithAbort;
  const started = now();
  let response: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (init.signal?.aborted) throw abortReason(init.signal);
    response = await fetchImpl(input, init);
    if (!isRetryableStatus(response.status) || attempt >= retries) return response;
    const remaining = deadlineMs - (now() - started);
    if (remaining <= 0) return response;
    const retryAfter = retryAfterMs(response.headers.get("Retry-After"), now());
    const jitter = jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
    const delay = Math.min(remaining, maxBackoffMs, retryAfter ?? 250 * (attempt + 1) + jitter);
    if (delay <= 0) return response;
    await sleep(delay, init.signal ?? undefined);
  }
  return response!;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(abortReason(signal!));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Request cancelled", "AbortError");
}
