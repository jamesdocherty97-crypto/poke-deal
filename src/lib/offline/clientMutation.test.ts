import assert from "node:assert/strict";
import test from "node:test";
import { readClientMutationId, saleMutationFields } from "./clientMutation.js";

test("client mutation id accepts offline UUID-like keys and rejects unsafe values", () => {
  const accepted = readClientMutationId(new Request("https://example.test", {
    headers: { "X-Poke-Deal-Mutation-Id": "buy:018f9e02-5b4e-7f00-a000-123456789abc" },
  }));
  assert.deepEqual(accepted, { ok: true, value: "buy:018f9e02-5b4e-7f00-a000-123456789abc" });
  const rejected = readClientMutationId(new Request("https://example.test", {
    headers: { "X-Poke-Deal-Mutation-Id": "spaces are unsafe" },
  }));
  assert.equal(rejected.ok, false);
});

test("multi-unit sale rows share a durable mutation key with deterministic indexes", () => {
  assert.deepEqual(saleMutationFields("sale:12345678", 0), { clientMutationId: "sale:12345678", mutationIndex: 0 });
  assert.deepEqual(saleMutationFields("sale:12345678", 1), { clientMutationId: "sale:12345678", mutationIndex: 1 });
  assert.deepEqual(saleMutationFields(null, 0), {});
});
