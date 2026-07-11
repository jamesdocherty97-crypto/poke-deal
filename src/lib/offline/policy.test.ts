import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFLINE_COMP_MAX_AGE_MS,
  canonicalCompCacheKey,
  compCacheFreshness,
  isDueOfflineMutation,
  offlineRetryDelayMs,
  shouldRetryOfflineResponse,
} from "./policy.js";

test("canonical comp keys lock equivalent card identities and grades", () => {
  assert.equal(
    canonicalCompCacheKey({ name: "  Pikachu ", setName: "Crown Zenith", number: "GG30/GG70", grade: "PSA_10" }),
    canonicalCompCacheKey({ name: "pikachu", setName: "CROWN-ZENITH", number: "gg30 gg70", grade: "psa 10" }),
  );
  assert.notEqual(
    canonicalCompCacheKey({ name: "Pikachu", setName: "Crown Zenith", number: "GG30", grade: "RAW" }),
    canonicalCompCacheKey({ name: "Pikachu", setName: "Crown Zenith", number: "GG30", grade: "PSA_10" }),
  );
});

test("catalog ids take precedence while optional scan fingerprints partition collisions", () => {
  const base = { name: "Umbreon", setName: "Evolving Skies", grade: "RAW", tcgApiId: "swsh7-215" };
  assert.equal(
    canonicalCompCacheKey(base),
    canonicalCompCacheKey({ ...base, name: "Umbreon VMAX", number: "215/203" }),
  );
  assert.notEqual(
    canonicalCompCacheKey(base),
    canonicalCompCacheKey({ ...base, scanFingerprint: "photo-a" }),
  );
});

test("cache policy distinguishes usable fresh, stale and expired receipts", () => {
  const now = Date.UTC(2026, 6, 11, 12);
  assert.equal(compCacheFreshness(now - 60_000, now).state, "fresh");
  assert.equal(compCacheFreshness(now - 25 * 60 * 60 * 1_000, now).state, "stale");
  const expired = compCacheFreshness(now - OFFLINE_COMP_MAX_AGE_MS - 1, now);
  assert.equal(expired.state, "expired");
  assert.ok(expired.ageHours >= 168);
});

test("retry policy backs off, caps and only retries transient HTTP failures", () => {
  assert.equal(offlineRetryDelayMs(0), 1_000);
  assert.equal(offlineRetryDelayMs(20), 15 * 60 * 1_000);
  assert.equal(shouldRetryOfflineResponse(429), true);
  assert.equal(shouldRetryOfflineResponse(401), true);
  assert.equal(shouldRetryOfflineResponse(503), true);
  assert.equal(shouldRetryOfflineResponse(422), false);
  assert.equal(isDueOfflineMutation({ nextAttemptAt: "2026-07-11T11:59:59.000Z" }, "2026-07-11T12:00:00.000Z"), true);
  assert.equal(isDueOfflineMutation({ nextAttemptAt: "2026-07-11T12:00:01.000Z" }, "2026-07-11T12:00:00.000Z"), false);
});
