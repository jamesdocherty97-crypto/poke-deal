import assert from "node:assert/strict";
import test from "node:test";
import { evaluateScanBudget, hashScanSession, scanSessionTokenFromRequest, ukScanBudgetWindow } from "./scanBudget.js";

test("scan budget enforces both global cost and per-session fairness", () => {
  assert.deepEqual(evaluateScanBudget({ daily: 599, session: 119 }, { daily: 600, session: 120 }), { allowed: true });
  assert.deepEqual(evaluateScanBudget({ daily: 600, session: 2 }, { daily: 600, session: 120 }), { allowed: false, reason: "daily", limit: 600 });
  assert.deepEqual(evaluateScanBudget({ daily: 2, session: 120 }, { daily: 600, session: 120 }), { allowed: false, reason: "session", limit: 120 });
});

test("session hashing is stable and does not retain the raw token", () => {
  const value = hashScanSession("device-session-secret", "test-secret");
  assert.equal(value, hashScanSession("device-session-secret", "test-secret"));
  assert.equal(value.includes("device-session-secret"), false);
  assert.equal(value.length, 40);
});

test("scan session identity never falls back to a per-request mutation id", () => {
  const first = scanSessionTokenFromRequest(new Request("https://example.test/api/scan", {
    headers: {
      "x-poke-deal-mutation-id": "scan:mutation-0001",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "user-agent": "Poke Deal Test Device",
    },
  }));
  const second = scanSessionTokenFromRequest(new Request("https://example.test/api/scan", {
    headers: {
      "x-poke-deal-mutation-id": "scan:mutation-0002",
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "Poke Deal Test Device",
    },
  }));
  assert.equal(first, second);
  assert.equal(first.includes("mutation"), false);
});

test("explicit stable scan session header overrides the bounded UA/IP fallback", () => {
  const token = scanSessionTokenFromRequest(new Request("https://example.test/api/scan", {
    headers: {
      "x-poke-deal-session-id": `device:${"a".repeat(400)}`,
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "ignored",
    },
  }));
  assert.match(token, /^session:device:/);
  assert.ok(token.length <= "session:".length + 256);
  assert.equal(token.includes("203.0.113.7"), false);
});

test("scan budget resets at 08:00 Europe/London across summer time", () => {
  const before = ukScanBudgetWindow(new Date("2026-07-11T06:59:00.000Z"));
  const after = ukScanBudgetWindow(new Date("2026-07-11T07:01:00.000Z"));
  assert.equal(before.key, "2026-07-10");
  assert.equal(after.key, "2026-07-11");
  assert.equal(after.from.toISOString(), "2026-07-11T07:00:00.000Z");
});
