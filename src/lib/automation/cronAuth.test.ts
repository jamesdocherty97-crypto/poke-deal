import test from "node:test";
import assert from "node:assert/strict";
import { allowsPublicAppAccess, requiresTrustedDeviceAccess } from "../auth/appAccess.js";
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

test("production deployments require trusted-device access", () => {
  assert.equal(requiresTrustedDeviceAccess({ VERCEL_ENV: "production", NODE_ENV: "production" }, "poke-deal.test"), true);
  assert.equal(requiresTrustedDeviceAccess({ NODE_ENV: "production" }, "poke-deal.test"), true);
});

test("explicit public testing mode bypasses the trusted-device gate only on loopback", () => {
  const env = { APP_PUBLIC_ACCESS: "true", NODE_ENV: "production" };
  assert.equal(allowsPublicAppAccess(env, "localhost"), true);
  assert.equal(allowsPublicAppAccess(env, "127.0.0.1"), true);
  assert.equal(requiresTrustedDeviceAccess(env, "localhost"), false);
  assert.equal(allowsPublicAppAccess(env, "poke-deal.test"), false);
  assert.equal(requiresTrustedDeviceAccess(env, "poke-deal.test"), true);
});

test("every hosted Vercel environment ignores the public testing escape hatch", () => {
  const env = { APP_PUBLIC_ACCESS: "true", VERCEL_ENV: "production", NODE_ENV: "production" };
  assert.equal(allowsPublicAppAccess(env, "localhost"), false);
  assert.equal(requiresTrustedDeviceAccess(env, "localhost"), true);
  assert.equal(allowsPublicAppAccess({ ...env, VERCEL_ENV: "preview" }, "localhost"), false);
  assert.equal(requiresTrustedDeviceAccess({ ...env, VERCEL_ENV: "preview" }, "localhost"), true);
});

test("public testing mode must be explicitly true", () => {
  assert.equal(allowsPublicAppAccess({ APP_PUBLIC_ACCESS: "false" }, "localhost"), false);
  assert.equal(allowsPublicAppAccess({ APP_PUBLIC_ACCESS: "1" }, "localhost"), false);
  assert.equal(allowsPublicAppAccess({}, "localhost"), false);
});

test("local development is open but hosted previews fail closed", () => {
  assert.equal(requiresTrustedDeviceAccess({ NODE_ENV: "development" }, "localhost"), false);
  assert.equal(requiresTrustedDeviceAccess({ VERCEL_ENV: "preview", NODE_ENV: "production" }, "preview.test"), true);
  assert.equal(requiresTrustedDeviceAccess({ VERCEL_ENV: "development", NODE_ENV: "production" }, "localhost"), false);
});
