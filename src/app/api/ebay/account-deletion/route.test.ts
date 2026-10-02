import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test, { type TestContext } from "node:test";
import { clearTokenCache } from "../../../../lib/ebay/tokens.js";
import { GET, POST } from "./route.js";

const callbackUrl = "https://callback.test/api/ebay/account-deletion";
const verificationToken = "test-token_123456789012345678901234567890";
const notification = {
  metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
  notification: { notificationId: "notification-1", data: { userId: "buyer-1" } },
};
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
let nextKeyId = 0;

test("GET returns the challenge hash for the registered endpoint", { concurrency: false }, async (t) => {
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

test("POST acknowledges signed deletions, replays, and zero matches with an empty 204", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  const unrelatedPayload = fixture.rows[1]!.payload;
  for (const message of [notification, notification, {
    ...notification,
    notification: { ...notification.notification, data: { userId: "unknown-buyer" } },
  }]) {
    const response = await POST(fixture.signedRequest(message));
    assert.equal(response.status, 204);
    assert.equal(response.body, null);
    assert.equal(await response.text(), "");
    assert.equal(fixture.rows[0]!.payload, null);
    assert.deepEqual(fixture.rows[1]!.payload, unrelatedPayload);
  }
  assert.equal(fixture.calls.reads, 3);
  assert.equal(fixture.calls.updates, 1);
  assert.equal(fixture.calls.provider, 2);
});

test("POST rejects missing config and missing or malformed signatures before processing", { concurrency: false }, async (t) => {
  const fixture = setup(t);
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

test("POST rejects a tampered signed notification without accessing the database", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  const original = fixture.signedRequest(notification);
  const response = await POST(postRequest(JSON.stringify({ ...notification, tampered: true }), {
    "x-ebay-signature": original.headers.get("x-ebay-signature")!,
  }));
  assert.equal(response.status, 412);
  assert.equal(fixture.calls.provider, 2);
  assert.equal(fixture.calls.reads, 0);
  assert.equal(fixture.calls.updates, 0);
});

test("POST rejects malformed or oversized JSON before signature verification or database access", { concurrency: false }, async (t) => {
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

test("POST rejects signed notifications for other topics or without identifiers", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  for (const message of [
    { ...notification, metadata: { topic: "OTHER_TOPIC" } },
    { ...notification, notification: { data: { userId: " " } } },
  ]) {
    assert.equal((await POST(fixture.signedRequest(message))).status, 400);
  }
  assert.equal(fixture.calls.provider, 2);
  assert.equal(fixture.calls.reads, 0);
  assert.equal(fixture.calls.updates, 0);
});

test("POST returns 503 when public-key lookup fails without scrubbing", { concurrency: false }, async (t) => {
  const fixture = setup(t, { keyLookupFails: true });
  assert.equal((await POST(fixture.signedRequest(notification))).status, 503);
  assert.equal(fixture.failedKeyLookups, 1);
  assert.equal(fixture.calls.provider, 2);
  assert.equal(fixture.calls.reads, 0);
  assert.equal(fixture.calls.updates, 0);
});

test("POST returns 503 rather than acknowledging failed scrubbing", { concurrency: false }, async (t) => {
  const fixture = setup(t);
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

function setup(t: TestContext, options: { keyLookupFails?: boolean } = {}) {
  const values = {
    EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN: verificationToken,
    EBAY_CLIENT_ID: "test-client",
    EBAY_CLIENT_SECRET: "test-secret",
    EBAY_RU_NAME: "test-redirect",
    EBAY_REDIRECT_URI: undefined,
    EBAY_ENV: "sandbox",
  };
  const previousEnv = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const globals = globalThis as typeof globalThis & { prisma?: unknown };
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
  globals.prisma = db;
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
