import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_ACCESS_SESSION_RENEWAL_WINDOW_SECONDS,
  APP_ACCESS_SESSION_TTL_SECONDS,
  createAccessSession,
  hasTrustedDeviceAccessConfig,
  inspectAccessSession,
  isValidAccessSession,
  isValidAccessToken,
  readTrustedDeviceAccessConfig,
} from "./accessSession.js";

const accessToken = "a".repeat(43);
const sessionSecret = "b".repeat(43);

test("trusted-device access requires two independent high-entropy secrets", () => {
  const valid = {
    APP_ACCESS_TOKEN: accessToken,
    APP_SESSION_SECRET: sessionSecret,
  };
  assert.deepEqual(readTrustedDeviceAccessConfig(valid), { accessToken, sessionSecret });
  assert.equal(hasTrustedDeviceAccessConfig(valid), true);
  assert.equal(hasTrustedDeviceAccessConfig({ ...valid, APP_ACCESS_TOKEN: "short" }), false);
  assert.equal(hasTrustedDeviceAccessConfig({ ...valid, APP_ACCESS_TOKEN: sessionSecret }), false);
  assert.equal(hasTrustedDeviceAccessConfig({ ...valid, APP_SESSION_SECRET: "!".repeat(43) }), false);
  assert.equal(hasTrustedDeviceAccessConfig({ APP_PASSWORD: "legacy-only" }), false);
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
  const secondSession = await createAccessSession(sessionSecret, now);

  assert.equal(await isValidAccessSession(session, sessionSecret, now), true);
  assert.equal(await isValidAccessSession(secondSession, sessionSecret, now), true);
  assert.notEqual(secondSession, session, "separate browser enrollments need distinct bearer cookies");
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

  const implausiblyFutureSession = await createAccessSession(sessionSecret, now + 10 * 60 * 1000);
  assert.equal(await isValidAccessSession(implausiblyFutureSession, sessionSecret, now), false);
});

test("trusted-device sessions renew only inside the final 30 days", async () => {
  const now = Date.UTC(2026, 6, 19, 12, 0, 0);
  const session = await createAccessSession(sessionSecret, now);
  const beforeRenewalWindow = now
    + (APP_ACCESS_SESSION_TTL_SECONDS - APP_ACCESS_SESSION_RENEWAL_WINDOW_SECONDS - 1) * 1000;
  const insideRenewalWindow = beforeRenewalWindow + 2_000;

  assert.deepEqual(await inspectAccessSession(session, sessionSecret, beforeRenewalWindow), {
    valid: true,
    shouldRenew: false,
    expiresAt: Math.floor(now / 1000) + APP_ACCESS_SESSION_TTL_SECONDS,
  });
  assert.deepEqual(await inspectAccessSession(session, sessionSecret, insideRenewalWindow), {
    valid: true,
    shouldRenew: true,
    expiresAt: Math.floor(now / 1000) + APP_ACCESS_SESSION_TTL_SECONDS,
  });
});
