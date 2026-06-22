import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedCronRequest } from "./cronAuth.js";

test("isAuthorizedCronRequest accepts the exact bearer secret", () => {
  assert.equal(isAuthorizedCronRequest("Bearer secret123", "secret123"), true);
});

test("isAuthorizedCronRequest rejects missing, wrong, and unset secrets", () => {
  assert.equal(isAuthorizedCronRequest(null, "secret123"), false);
  assert.equal(isAuthorizedCronRequest("Bearer wrong", "secret123"), false);
  assert.equal(isAuthorizedCronRequest("Bearer secret123", undefined), false);
  assert.equal(isAuthorizedCronRequest("Basic secret123", "secret123"), false);
});
