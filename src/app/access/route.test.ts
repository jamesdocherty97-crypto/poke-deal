import assert from "node:assert/strict";
import test from "node:test";
import { APP_ACCESS_COOKIE, APP_ACCESS_SESSION_TTL_SECONDS } from "../../lib/auth/accessSession.js";
import { DELETE, GET, POST } from "./route.js";

const accessToken = "a".repeat(43);
const sessionSecret = "b".repeat(43);

test("the enrollment page is configured, private, and non-cacheable", { concurrency: false }, async () => {
  await withAccessEnv(async () => {
    const response = GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.match(await response.text(), /Trusting this browser/i);
  });
});

test("the enrollment page fails closed without both access secrets", { concurrency: false }, async () => {
  await withEnv({}, async () => {
    const response = GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
  });
});

test("a valid same-origin token creates the host-only trusted-device cookie", { concurrency: false }, async () => {
  await withAccessEnv(async () => {
    const response = await POST(jsonRequest({ token: accessToken }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`^${APP_ACCESS_COOKIE}=`));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\//i);
    assert.match(cookie, new RegExp(`Max-Age=${APP_ACCESS_SESSION_TTL_SECONDS}`));
    assert.doesNotMatch(cookie, new RegExp(accessToken));
  });
});

test("same-origin enrollment accepts the browser Host when Next canonicalises localhost", { concurrency: false }, async () => {
  await withAccessEnv(async () => {
    const response = await POST(new Request("http://localhost:3000/access", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: accessToken }),
    }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`^${APP_ACCESS_COOKIE}=`));
  });
});

test("enrollment rejects cross-origin, wrong media type, malformed, and invalid requests", { concurrency: false }, async () => {
  await withAccessEnv(async () => {
    const crossOrigin = await POST(jsonRequest({ token: accessToken }, { origin: "https://attacker.test" }));
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.headers.get("set-cookie"), null);

    const forgedForwardedOrigin = await POST(new Request("https://poke-deal.test/access", {
      method: "POST",
      headers: {
        host: "poke-deal.test",
        origin: "https://attacker.test",
        "x-forwarded-host": "poke-deal.test",
        "x-forwarded-proto": "https",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: accessToken }),
    }));
    assert.equal(forgedForwardedOrigin.status, 403);

    const wrongType = await POST(new Request("https://poke-deal.test/access", {
      method: "POST",
      headers: { origin: "https://poke-deal.test", "content-type": "text/plain" },
      body: JSON.stringify({ token: accessToken }),
    }));
    assert.equal(wrongType.status, 415);

    const malformed = await POST(new Request("https://poke-deal.test/access", {
      method: "POST",
      headers: { origin: "https://poke-deal.test", "content-type": "application/json" },
      body: "{",
    }));
    assert.equal(malformed.status, 400);

    const nullJson = await POST(jsonRequest(null));
    assert.equal(nullJson.status, 400);

    const invalid = await POST(jsonRequest({ token: "x".repeat(43) }));
    assert.equal(invalid.status, 401);
    assert.equal(invalid.headers.get("set-cookie"), null);

    const oversized = await POST(new Request("https://poke-deal.test/access", {
      method: "POST",
      headers: {
        origin: "https://poke-deal.test",
        "content-type": "application/json",
        "content-length": "1025",
      },
      body: JSON.stringify({ token: accessToken }),
    }));
    assert.equal(oversized.status, 413);

    const chunkedOversized = await POST(new Request("https://poke-deal.test/access", {
      method: "POST",
      headers: {
        origin: "https://poke-deal.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: "x".repeat(1_100) }),
    }));
    assert.equal(chunkedOversized.status, 413);
  });
});

test("deleting access clears the trusted-device cookie only from the same origin", { concurrency: false }, async () => {
  await withAccessEnv(async () => {
    const denied = DELETE(new Request("https://poke-deal.test/access", {
      method: "DELETE",
      headers: { origin: "https://attacker.test" },
    }));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("set-cookie"), null);

    const response = DELETE(new Request("https://poke-deal.test/access", {
      method: "DELETE",
      headers: { origin: "https://poke-deal.test" },
    }));
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`^${APP_ACCESS_COOKIE}=`));
    assert.match(cookie, /Max-Age=0/i);
    assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
    assert.equal(response.headers.get("clear-site-data"), '"cache", "cookies", "storage"');
  });
});

function jsonRequest(
  value: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://poke-deal.test/access", {
    method: "POST",
    headers: {
      origin: "https://poke-deal.test",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(value),
  });
}

async function withAccessEnv(run: () => Promise<void>): Promise<void> {
  await withEnv({ APP_ACCESS_TOKEN: accessToken, APP_SESSION_SECRET: sessionSecret }, run);
}

async function withEnv(
  values: Record<string, string>,
  run: () => Promise<void>,
): Promise<void> {
  const keys = ["APP_ACCESS_TOKEN", "APP_SESSION_SECRET"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
