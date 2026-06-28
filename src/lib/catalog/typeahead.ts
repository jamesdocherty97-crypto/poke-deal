export async function settleTypeaheadSource<T>(
  work: Promise<T>,
  fallback: T,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    work.catch(() => fallback),
    delay(timeoutMs).then(() => fallback),
  ]);
}

function delay(timeoutMs: number): Promise<void> {
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  return new Promise((resolve) => {
    setTimeout(resolve, safeTimeoutMs);
  });
}
