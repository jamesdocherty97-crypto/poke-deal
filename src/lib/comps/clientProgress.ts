import type { CompProgressEvent } from "./progressContract.js";

export type CompProgressChunk = {
  events: CompProgressEvent[];
  remainder: string;
};

export function parseCompProgressChunk(buffer: string, final = false): CompProgressChunk {
  const lines = buffer.split("\n");
  const remainder = final ? "" : lines.pop() ?? "";
  const events: CompProgressEvent[] = [];
  for (const line of lines) {
    const value = line.trim();
    if (!value) continue;
    events.push(JSON.parse(value) as CompProgressEvent);
  }
  if (final && lines.length === 0 && buffer.trim()) {
    events.push(JSON.parse(buffer.trim()) as CompProgressEvent);
  }
  return { events, remainder };
}

export async function readCompProgress(
  response: Response,
  onEvent: (event: CompProgressEvent) => void | Promise<void>,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  if (!response.body) throw new Error("This browser cannot read progressive comp results.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abort = () => void reader.cancel(options.signal?.reason).catch(() => undefined);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (options.signal?.aborted) throw abortError(options.signal.reason);
      const { value, done } = await reader.read();
      // Cancelling a pending reader resolves read() with done=true in some
      // runtimes. Re-check the signal so a superseded lookup cannot look like
      // a successfully completed stream.
      if (options.signal?.aborted) throw abortError(options.signal.reason);
      buffer += decoder.decode(value, { stream: !done });
      const parsed = parseCompProgressChunk(buffer, done);
      buffer = parsed.remainder;
      for (const event of parsed.events) {
        if (options.signal?.aborted) throw abortError(options.signal.reason);
        await onEvent(event);
      }
      if (done) return;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new DOMException("The comp lookup was cancelled.", "AbortError");
}
