export function createAbortScope(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const relay = () => controller.abort(parent?.reason);
  if (parent?.aborted) relay();
  else parent?.addEventListener("abort", relay, { once: true });
  const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error("request timeout")), timeoutMs)
    : undefined;
  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      parent?.removeEventListener("abort", relay);
    },
  };
}
