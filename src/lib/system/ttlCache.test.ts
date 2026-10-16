import assert from "node:assert/strict";
import test from "node:test";
import { createTtlCache } from "./ttlCache.js";

test("ttl cache serves repeats from memory until expiry and shares in-flight loads", async () => {
  let clock = 1_000;
  let loads = 0;
  const read = createTtlCache(async () => ++loads, 60_000, () => clock);

  const [a, b] = await Promise.all([read(), read()]);
  assert.equal(loads, 1);
  assert.deepEqual([a.value, a.hit, b.value], [1, false, 1]);

  clock += 59_999;
  assert.deepEqual(await read(), { value: 1, hit: true, expiresAt: 61_000 });
  assert.equal(loads, 1);

  clock += 1;
  assert.deepEqual(await read(), { value: 2, hit: false, expiresAt: 121_000 });
});

test("ttl cache does not keep a failed load", async () => {
  let fail = true;
  let loads = 0;
  const read = createTtlCache(async () => {
    loads++;
    if (fail) throw new Error("down");
    return "ok";
  }, 60_000);
  await assert.rejects(read(), /down/);
  fail = false;
  assert.equal((await read()).value, "ok");
  assert.equal(loads, 2);
});
