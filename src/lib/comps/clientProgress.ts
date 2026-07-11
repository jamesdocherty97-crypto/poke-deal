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
): Promise<void> {
  if (!response.body) throw new Error("This browser cannot read progressive comp results.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parsed = parseCompProgressChunk(buffer, done);
    buffer = parsed.remainder;
    for (const event of parsed.events) await onEvent(event);
    if (done) return;
  }
}
