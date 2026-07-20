import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_ACCESS_SESSION_TTL_SECONDS,
  createAccessSession,
  hasPasswordlessAccessConfig,
  isValidAccessSession,
  isValidAccessToken,
  readPasswordlessAccessConfig,
} from "./accessSession.js";

const accessToken = "a".repeat(43);
const sessionSecret = "b".repeat(43);
const password = "hidden-fallback-password";

test("passwordless access requires independent high-entropy secrets and the fallback password", () => {
  const valid = {
    APP_PASSWORD: password,
    APP_ACCESS_TOKEN: accessToken,
    APP_SESSION_SECRET: sessionSecret,
  };
  assert.deepEqual(readPasswordlessAccessConfig(valid), { accessToken, sessionSecret });
  assert.equal(hasPasswordlessAccessConfig(valid), true);
  assert.equal(hasPasswordlessAccessConfig({ ...valid, APP_PASSWORD: "" }), false);
  assert.equal(hasPasswordlessAccessConfig({ ...valid, APP_ACCESS_TOKEN: "short" }), false);
  assert.equal(hasPasswordlessAccessConfig({ ...valid, APP_ACCESS_TOKEN: sessionSecret }), false);
  assert.equal(hasPasswordlessAccessConfig({ ...valid, APP_SESSION_SECRET: "!".repeat(43) }), false);
});

test("access-token comparison accepts only the exact bounded token", async () => {
  assert.equal(await isValidAccessToken(accessToken, accessToken), true);
  assert.equal(await isValidAccessToken(`${accessToken.slice(0, -1)}b`, accessToken), false);
  assert.equal(await isValidAccessToken("short", accessToken), false);
  assert.equal(await isValidAccessToken("x".repeat(257), accessToken), false);
  assert.equal(await isValidAccessToken(null, accessToken), false);
});

test("access sessions are signed, secret-bound, expiry-bound, and tamper evident", async () => {
  const now = Date.UTC(2026, 6, 19, 12, 0, 0);
  const session = await createAccessSession(sessionSecret, now);

  assert.equal(await isValidAccessSession(session, sessionSecret, now), true);
  assert.equal(await isValidAccessSession(session, "c".repeat(43), now), false);
  assert.equal(await isValidAccessSession(`${session.slice(0, -1)}x`, sessionSecret, now), false);
  assert.equal(
    await isValidAccessSession(
      session,
      sessionSecret,
      now + APP_ACCESS_SESSION_TTL_SECONDS * 1000,
    ),
    false,
  );
  assert.equal(await isValidAccessSession("v1.not-a-time.signature", sessionSecret, now), false);
});
