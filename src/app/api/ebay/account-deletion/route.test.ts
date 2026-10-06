import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test, { type TestContext } from "node:test";
import { clearTokenCache } from "../../../../lib/ebay/tokens.js";
import { GET, POST } from "./route.js";

// Route-level coverage for the eBay Marketplace Account Deletion callback.
// The fixture pattern (fake eBay provider + injected globalThis.prisma) follows
// draft PR #22. The key guarantee here: with EBAY_DELETION_SCRUB unset, a valid
// signed notification is acknowledged with 204 and the database is never used.

const callbackUrl = "https://callback.test/api/ebay/account-deletion";
const verificationToken = "test-token_123456789012345678901234567890";
const notification = {
  metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
  notification: { notificationId: "notification-1", data: { userId: "buyer-1" } },
};
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
let nextKeyId = 0;

type Globals = typeof globalThis & { prisma?: unknown };

test("GET returns the challenge hash for the registered endpoint without DB access", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  const challenge = "challenge+with spaces";
  const response = await GET(new Request(`${callbackUrl}?challenge_code=${encodeURIComponent(challenge)}`));
  const expected = createHash("sha256")
    .update(challenge)
    .update(verificationToken)
    .update("https://poke-deal.vercel.app/api/ebay/account-deletion")
    .digest("hex");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await response.json(), { challengeResponse: expected });
  assert.deepEqual(fixture.calls, { provider: 0, reads: 0, updates: 0 });
});

test("GET rejects missing challenges and unavailable verification tokens", { concurrency: false }, async (t) => {
  setup(t);
  for (const query of ["", "?challenge_code="]) {
    assert.equal((await GET(new Request(`${callbackUrl}${query}`))).status, 400);
  }
  for (const token of [undefined, "too-short"]) {
    if (token === undefined) delete process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN;
    else process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN = token;
    assert.equal((await GET(new Request(`${callbackUrl}?challenge_code=challenge`))).status, 503);
  }
});

test("POST (scrub off by default) acknowledges a valid signed notification with 204 and zero DB calls", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  const before = structuredClone(fixture.rows);
  for (const message of [notification, notification, {
    ...notification,
    notification: { ...notification.notification, data: { userId: "unknown-buyer" } },
  }]) {
    const response = await POST(fixture.signedRequest(message));
    assert.equal(response.status, 204);
    assert.equal(response.body, null);
    assert.equal(await response.text(), "");
  }
  // Signature verification still happens (token + public key fetched once, then cached)...
  assert.equal(fixture.calls.provider, 2);
  // ...but the database is never read or written.
  assert.equal(fixture.calls.reads, 0);
  assert.equal(fixture.calls.updates, 0);
  assert.deepEqual(fixture.rows, before);
});

test("POST (scrub off) never constructs a Prisma client on the acknowledgement path", { concurrency: false }, async (t) => {
  // No injected DB: getPrisma() would construct a real PrismaClient and cache
  // it on globalThis.prisma. It must stay undefined, proving getPrisma() was
  // never called and no client/connection was created.
  const fixture = setup(t, { injectDb: false });
  const globals = globalThis as Globals;
  assert.equal(globals.prisma, undefined);
  const response = await POST(fixture.signedRequest(notification));
  assert.equal(response.status, 204);
  assert.equal(globals.prisma, undefined);
});

test("POST treats any EBAY_DELETION_SCRUB value other than exactly 1 as off", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  for (const value of ["", "0", "true", "yes", "01"]) {
    process.env.EBAY_DELETION_SCRUB = value;
    assert.equal((await POST(fixture.signedRequest(notification))).status, 204);
  }
  assert.equal(fixture.calls.reads, 0);
  assert.equal(fixture.calls.updates, 0);
});

for (const scrub of [false, true]) {
  const label = scrub ? "scrub on" : "scrub off";

  test(`POST (${label}) rejects missing config and missing or malformed signatures with the same statuses`, { concurrency: false }, async (t) => {
    const fixture = setup(t, { scrub });
    delete process.env.EBAY_CLIENT_ID;
    assert.equal((await POST(fixture.signedRequest(notification))).status, 503);
    process.env.EBAY_CLIENT_ID = "test-client";

    for (const signature of [undefined, " ", "invalid-base64"]) {
      const response = await POST(postRequest(JSON.stringify(notification),
        signature === undefined ? {} : { "x-ebay-signature": signature }));
      assert.equal(response.status, 412);
    }
    assert.deepEqual(fixture.calls, { provider: 0, reads: 0, updates: 0 });
  });

  test(`POST (${label}) rejects a tampered signed notification with 412 and no DB access`, { concurrency: false }, async (t) => {
    const fixture = setup(t, { scrub });
    const original = fixture.signedRequest(notification);
    const response = await POST(postRequest(JSON.stringify({ ...notification, tampered: true }), {
      "x-ebay-signature": original.headers.get("x-ebay-signature")!,
    }));
    assert.equal(response.status, 412);
    assert.deepEqual(await response.json(), { error: "Invalid eBay signature." });
    assert.equal(fixture.calls.provider, 2);
    assert.equal(fixture.calls.reads, 0);
    assert.equal(fixture.calls.updates, 0);
  });

  test(`POST (${label}) rejects signed notifications for other topics or without identifiers`, { concurrency: false }, async (t) => {
    const fixture = setup(t, { scrub });
    for (const message of [
      { ...notification, metadata: { topic: "OTHER_TOPIC" } },
      { ...notification, notification: { data: { userId: " " } } },
    ]) {
      assert.equal((await POST(fixture.signedRequest(message))).status, 400);
    }
    assert.equal(fixture.calls.reads, 0);
    assert.equal(fixture.calls.updates, 0);
  });

  test(`POST (${label}) returns 503 when public-key lookup fails`, { concurrency: false }, async (t) => {
    const fixture = setup(t, { scrub, keyLookupFails: true });
    assert.equal((await POST(fixture.signedRequest(notification))).status, 503);
    assert.equal(fixture.failedKeyLookups, 1);
    assert.equal(fixture.calls.reads, 0);
    assert.equal(fixture.calls.updates, 0);
  });
}

test("POST rejects malformed or oversized JSON before signature verification or DB access", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  for (const [body, headers, status] of [
    ["{", {}, 400],
    ["{}", { "content-length": String(256 * 1024 + 1) }, 413],
    [JSON.stringify({ padding: "x".repeat(256 * 1024) }), {}, 413],
  ] as const) {
    const response = await POST(postRequest(body, { "x-ebay-signature": "present", ...headers }));
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.deepEqual(fixture.calls, { provider: 0, reads: 0, updates: 0 });
});

test("POST with EBAY_DELETION_SCRUB=1 still scrubs matching payloads and acknowledges with 204", { concurrency: false }, async (t) => {
  const fixture = setup(t, { scrub: true });
  const unrelatedPayload = fixture.rows[1]!.payload;
  for (const message of [notification, notification, {
    ...notification,
    notification: { ...notification.notification, data: { userId: "unknown-buyer" } },
  }]) {
    const response = await POST(fixture.signedRequest(message));
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.equal(fixture.rows[0]!.payload, null);
    assert.deepEqual(fixture.rows[1]!.payload, unrelatedPayload);
  }
  assert.equal(fixture.calls.reads, 3);
  assert.equal(fixture.calls.updates, 1);
  assert.equal(fixture.calls.provider, 2);
});

test("POST with EBAY_DELETION_SCRUB=1 returns 503 rather than acknowledging a failed scrub", { concurrency: false }, async (t) => {
  const fixture = setup(t, { scrub: true });
  const update = t.mock.method(fixture.db.ebayOrderImport, "update", async () => { throw new Error("Database unavailable"); });
  const response = await POST(fixture.signedRequest(notification));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Account deletion processing failed." });
  assert.equal(fixture.calls.reads, 1);
  assert.equal(update.mock.callCount(), 1);
  assert.notEqual(fixture.rows[0]!.payload, null);
});

function postRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request(callbackUrl, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

function setup(t: TestContext, options: { scrub?: boolean; injectDb?: boolean; keyLookupFails?: boolean } = {}) {
  const values: Record<string, string | undefined> = {
    EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN: verificationToken,
    EBAY_CLIENT_ID: "test-client",
    EBAY_CLIENT_SECRET: "test-secret",
    EBAY_RU_NAME: "test-redirect",
    EBAY_REDIRECT_URI: undefined,
    EBAY_ENV: "sandbox",
    EBAY_DELETION_SCRUB: options.scrub ? "1" : undefined,
    // Belt and braces: never let a route test reach a real database.
    DATABASE_URL: undefined,
  };
  const previousEnv = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const globals = globalThis as Globals;
  const previousDb = globals.prisma;
  // The public-key cache has no reset: each fixture must use a fresh key ID.
  const keyId = `route-test-${++nextKeyId}`;
  const calls = { provider: 0, reads: 0, updates: 0 };
  let failedKeyLookups = 0;
  const rows: Array<{ id: string; payload: unknown }> = [
    { id: "matching", payload: { order: { buyer: { userId: "buyer-1" } } } },
    { id: "unrelated", payload: { order: { buyer: { userId: "buyer-10" } } } },
  ];
  const db = {
    ebayOrderImport: {
      async findMany() { calls.reads++; return rows.filter((row) => row.payload !== null); },
      async update({ where, data }: { where: { id: string }; data: { payload: null } }) {
        calls.updates++;
        const row = rows.find((candidate) => candidate.id === where.id)!;
        row.payload = data.payload;
        return row;
      },
    },
  };
  clearTokenCache();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (options.injectDb === false) delete globals.prisma;
  else globals.prisma = db;
  t.after(() => {
    clearTokenCache();
    if (previousDb === undefined) delete globals.prisma;
    else globals.prisma = previousDb;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.method(console, "info", () => undefined);
  t.mock.method(console, "error", () => undefined);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.provider++;
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://api.sandbox.ebay.com/identity/v1/oauth2/token") {
      assert.equal(init?.method, "POST");
      return Response.json({ access_token: "test-access-token", expires_in: 3600 });
    }
    assert.equal(url, `https://api.sandbox.ebay.com/commerce/notification/v1/public_key/${keyId}`);
    assert.equal(init?.method, "GET");
    if (options.keyLookupFails) {
      failedKeyLookups++;
      return Response.json({ error: "Unavailable" }, { status: 503 });
    }
    return Response.json({ key: publicKey.export({ type: "spki", format: "pem" }).toString() });
  });
  return {
    calls, rows, db,
    get failedKeyLookups() { return failedKeyLookups; },
    signedRequest(message: unknown) {
      const body = JSON.stringify(message);
      const signature = sign("sha256", Buffer.from(body), privateKey).toString("base64");
      const header = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: keyId, signature, digest: "SHA256" })).toString("base64");
      return postRequest(body, { "x-ebay-signature": header });
    },
  };
}
