import assert from "node:assert/strict";
import test from "node:test";
import { parseCompProgressChunk, readCompProgress } from "./clientProgress.js";

const catalog = JSON.stringify({ version: 1, type: "catalog", lookupId: "look-12345678", sequence: 1, emittedAt: "2026-07-11T12:00:00.000Z" });
const receipt = JSON.stringify({ version: 1, type: "receipt", lookupId: "look-12345678", sequence: 2, emittedAt: "2026-07-11T12:00:01.000Z" });

test("progress parser retains split NDJSON records without losing order", () => {
  const first = parseCompProgressChunk(`${catalog}\n${receipt.slice(0, 20)}`);
  assert.deepEqual(first.events.map((event) => event.type), ["catalog"]);
  const second = parseCompProgressChunk(`${first.remainder}${receipt.slice(20)}\n`);
  assert.deepEqual(second.events.map((event) => event.type), ["receipt"]);
  assert.equal(second.remainder, "");
});

test("progress response reader emits catalog through terminal receipt across chunks", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${catalog}\n${receipt.slice(0, 12)}`));
      controller.enqueue(encoder.encode(`${receipt.slice(12)}\n`));
      controller.close();
    },
  });
  const seen: string[] = [];
  await readCompProgress(new Response(stream), (event) => { seen.push(event.type); });
  assert.deepEqual(seen, ["catalog", "receipt"]);
});

test("progress reader cancels and releases the stream when a lookup is superseded", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; },
  });
  const controller = new AbortController();
  const reading = readCompProgress(new Response(stream), () => undefined, { signal: controller.signal });
  controller.abort(new DOMException("Superseded", "AbortError"));

  await assert.rejects(reading, /Superseded|cancelled/);
  assert.equal(cancelled, true);
});

test("progress reader cancels the response when an event handler fails", async () => {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(`${catalog}\n`)); },
    cancel() { cancelled = true; },
  });

  await assert.rejects(
    readCompProgress(new Response(stream), () => { throw new Error("stale handler"); }),
    /stale handler/,
  );
  assert.equal(cancelled, true);
});
