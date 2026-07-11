import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedJson } from "./boundedJson.js";

test("bounded JSON rejects declared oversize before reading or parsing", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    headers: { "content-length": "100" },
    body: "{}",
  });
  assert.deepEqual(await readBoundedJson(request, 10), {
    ok: false,
    status: 413,
    error: "Request body is too large.",
  });
});

test("bounded JSON caps actual chunked bytes and returns measured input size", async () => {
  const accepted = await readBoundedJson<{ value: number }>(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ value: 42 }),
  }), 100);
  assert.equal(accepted.ok && accepted.value.value, 42);
  assert.equal(accepted.ok && accepted.bytes, 12);

  const rejected = await readBoundedJson(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ value: "too long" }),
  }), 10);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.status, 413);
});
