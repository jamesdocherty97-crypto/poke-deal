import assert from "node:assert/strict";
import test from "node:test";
import { fetchReadWithRetry } from "./fetchReadWithRetry.js";

test("idempotent read retries one 429 and honors bounded Retry-After", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fetchImpl = (async () => ++calls === 1
    ? new Response("", { status: 429, headers: { "Retry-After": "1" } })
    : Response.json({ ok: true })) as typeof fetch;
  const result = await fetchReadWithRetry(fetchImpl, "https://provider.test/read", {}, {
    maxBackoffMs: 500,
    jitterMs: 0,
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [500]);
});

test("read retry does not retry permanent failures or writes", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response("", { status: 400 }); }) as typeof fetch;
  assert.equal((await fetchReadWithRetry(fetchImpl, "https://provider.test/read")).status, 400);
  assert.equal((await fetchReadWithRetry(fetchImpl, "https://provider.test/write", { method: "POST" })).status, 400);
  assert.equal(calls, 2);
});

test("read retry stops during abort-aware backoff", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response("", { status: 503 }); }) as typeof fetch;
  await assert.rejects(
    fetchReadWithRetry(fetchImpl, "https://provider.test/read", { signal: controller.signal }, {
      sleep: async () => { controller.abort(new DOMException("cancelled", "AbortError")); throw controller.signal.reason; },
    }),
    /cancelled/,
  );
  assert.equal(calls, 1);
});
