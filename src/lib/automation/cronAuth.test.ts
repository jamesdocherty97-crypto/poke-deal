import test from "node:test";
import assert from "node:assert/strict";
import { allowsPublicAppAccess, requiresAppPassword } from "../auth/appAccess.js";
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

test("production deployments require the private app password", () => {
  assert.equal(requiresAppPassword({ VERCEL_ENV: "production", NODE_ENV: "production" }), true);
  assert.equal(requiresAppPassword({ NODE_ENV: "production" }), true);
});

test("explicit public testing mode bypasses the app password gate", () => {
  const env = { APP_PUBLIC_ACCESS: "true", VERCEL_ENV: "production", NODE_ENV: "production" };
  assert.equal(allowsPublicAppAccess(env), true);
  assert.equal(requiresAppPassword(env), false);
});

test("public testing mode must be explicitly true", () => {
  assert.equal(allowsPublicAppAccess({ APP_PUBLIC_ACCESS: "false" }), false);
  assert.equal(allowsPublicAppAccess({ APP_PUBLIC_ACCESS: "1" }), false);
  assert.equal(allowsPublicAppAccess({}), false);
});

test("development and Vercel previews may run without the production password", () => {
  assert.equal(requiresAppPassword({ NODE_ENV: "development" }), false);
  assert.equal(requiresAppPassword({ VERCEL_ENV: "preview", NODE_ENV: "production" }), false);
  assert.equal(requiresAppPassword({ VERCEL_ENV: "development", NODE_ENV: "production" }), false);
});
