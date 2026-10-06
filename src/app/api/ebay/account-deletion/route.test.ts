import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test, { type TestContext } from "node:test";
import { Prisma } from "@prisma/client";
import { clearTokenCache } from "../../../../lib/ebay/tokens.js";
import { GET, POST } from "./route.js";

// Route-level coverage for the eBay Marketplace Account Deletion callback.
// Synthetic provider and database fixtures: success must mean the required
// legacy scrub completed, including when no environment flag is configured.

const callbackUrl = "https://callback.test/api/ebay/account-deletion";
const verificationToken = "test-token_123456789012345678901234567890";
const notification = {
  metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
  notification: { notificationId: "notification-1", data: { userId: "buyer-1" } },
};
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
let nextKeyId = 0;

const STORED_JSON_NULL = Symbol("stored JSON null");

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

test("POST without a flag scrubs matching legacy payloads before 204 and preserves the seller ledger on retries", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  const ledgerBefore = fixture.rows.map(({ payload, ...ledger }) => ledger);
  const unrelatedPayload = fixture.rows[1]!.payload;
  const minimizedPayload = fixture.rows[2]!.payload;
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
    assert.deepEqual(fixture.rows[2]!.payload, minimizedPayload);
    assert.deepEqual(fixture.rows.map(({ payload, ...ledger }) => ledger), ledgerBefore);
  }
  assert.equal(fixture.calls.provider, 2);
  assert.equal(fixture.calls.reads, 3);
  assert.equal(fixture.calls.updates, 1);
});

for (const value of ["", "0", "1", "true", "yes", "01"]) {
  test(`POST cannot skip the legacy scrub with retired EBAY_DELETION_SCRUB=${JSON.stringify(value)}`, { concurrency: false }, async (t) => {
    const fixture = setup(t, { legacyScrubSetting: value });
    assert.equal((await POST(fixture.signedRequest(notification))).status, 204);
    assert.equal(fixture.rows[0]!.payload, null);
    assert.equal(fixture.calls.reads, 1);
    assert.equal(fixture.calls.updates, 1);
  });
}

for (const legacyScrubSetting of [undefined, "0", "1"]) {
  const label = `legacy flag ${legacyScrubSetting ?? "unset"}`;

  test(`POST (${label}) rejects missing config and missing or malformed signatures with the same statuses`, { concurrency: false }, async (t) => {
    const fixture = setup(t, { legacyScrubSetting });
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
    const fixture = setup(t, { legacyScrubSetting });
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
    const fixture = setup(t, { legacyScrubSetting });
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
    const fixture = setup(t, { legacyScrubSetting, keyLookupFails: true });
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

test("POST sends Prisma null sentinels for the Json payload, never plain null", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  const response = await POST(fixture.signedRequest(notification));

  // Prisma 5.22 quietly reads plain `null` as JSON null, so the route still
  // answers 204 either way: only the recorded arguments tell the two apart.
  assert.equal(fixture.findManyArgs.length, 1);
  assert.notEqual(fixture.findManyArgs[0]!.where.payload.not, null, "the payload filter must not be plain null");
  assert.equal(fixture.findManyArgs[0]!.where.payload.not, Prisma.AnyNull, "the payload filter must be Prisma.AnyNull");
  assert.deepEqual(fixture.findManyArgs[0]!.select, { id: true, payload: true });

  assert.equal(fixture.updateArgs.length, 1);
  assert.deepEqual(fixture.updateArgs[0]!.where, { id: "matching" });
  assert.notEqual(fixture.updateArgs[0]!.data.payload, null, "the payload clear must not be plain null");
  assert.equal(fixture.updateArgs[0]!.data.payload, Prisma.DbNull, "the payload clear must be Prisma.DbNull");

  assert.equal(response.status, 204);
  assert.notEqual(fixture.rows[0]!.payload, STORED_JSON_NULL, "the cleared payload must not be a stored JSON null");
  assert.equal(fixture.rows[0]!.payload, null, "the cleared payload must be a database NULL");
});

test("POST returns 503 rather than acknowledging a failed scrub read", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  const read = t.mock.method(fixture.db.ebayOrderImport, "findMany", async () => { throw new Error("Database unavailable"); });
  const response = await POST(fixture.signedRequest(notification));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Account deletion processing failed." });
  assert.equal(read.mock.callCount(), 1);
  assert.equal(fixture.calls.updates, 0);
  assert.notEqual(fixture.rows[0]!.payload, null);
});

test("POST returns 503 rather than acknowledging a failed scrub write", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  const update = t.mock.method(fixture.db.ebayOrderImport, "update", async () => { throw new Error("Database unavailable"); });
  const response = await POST(fixture.signedRequest(notification));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Account deletion processing failed." });
  assert.equal(fixture.calls.reads, 1);
  assert.equal(update.mock.callCount(), 1);
  assert.notEqual(fixture.rows[0]!.payload, null);
});

test("POST retries a partial scrub without changing seller ledger fields or unrelated payloads", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  fixture.rows.push({
    ...fixture.rows[0]!, id: "matching-2", orderId: "order-3",
    payload: { order: { buyers: [{ userId: "buyer-1" }] } },
  });
  const ledgerBefore = fixture.rows.map(({ payload, ...ledger }) => ledger);
  const unrelatedPayload = fixture.rows[1]!.payload;
  const update = fixture.db.ebayOrderImport.update.bind(fixture.db.ebayOrderImport);
  let failNextWrite = true;
  t.mock.method(fixture.db.ebayOrderImport, "update", async (args: Parameters<typeof update>[0]) => {
    if (args.where.id === "matching-2" && failNextWrite) {
      failNextWrite = false;
      throw new Error("Temporary write failure");
    }
    return update(args);
  });

  assert.equal((await POST(fixture.signedRequest(notification))).status, 503);
  assert.equal(fixture.rows[0]!.payload, null);
  assert.notEqual(fixture.rows.at(-1)!.payload, null);
  assert.equal((await POST(fixture.signedRequest(notification))).status, 204);
  assert.equal(fixture.rows.at(-1)!.payload, null);
  assert.equal((await POST(fixture.signedRequest(notification))).status, 204);
  assert.equal(fixture.calls.updates, 2);
  assert.deepEqual(fixture.rows[1]!.payload, unrelatedPayload);
  assert.deepEqual(fixture.rows.map(({ payload, ...ledger }) => ledger), ledgerBefore);
});

function postRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request(callbackUrl, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

function setup(t: TestContext, options: { legacyScrubSetting?: string; keyLookupFails?: boolean } = {}) {
  const values: Record<string, string | undefined> = {
    EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN: verificationToken,
    EBAY_CLIENT_ID: "test-client",
    EBAY_CLIENT_SECRET: "test-secret",
    EBAY_RU_NAME: "test-redirect",
    EBAY_REDIRECT_URI: undefined,
    EBAY_ENV: "sandbox",
    EBAY_DELETION_SCRUB: options.legacyScrubSetting,
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
  const rows: Array<{ id: string; orderId: string; buyerPaidPence: number; saleId: string | null; payload: unknown }> = [
    { id: "matching", orderId: "order-1", buyerPaidPence: 1200, saleId: "sale-1", payload: { order: { buyer: { userId: "buyer-1" } } } },
    { id: "unrelated", orderId: "order-2", buyerPaidPence: 800, saleId: null, payload: { order: { buyer: { userId: "buyer-10" } } } },
    { id: "minimized", orderId: "order-4", buyerPaidPence: 1000, saleId: null, payload: { schemaVersion: 1, order: { orderId: "order-4" }, line: { lineItemId: "line-4" } } },
  ];
  // Models the nullable Json `payload` column: a stored `null` is a database
  // NULL and STORED_JSON_NULL is a stored JSON `null`. Plain `null` is not
  // rejected; it is read as JSON null in the filter and the write, which is
  // what Prisma 5.22 was observed to do on the CI database.
  const findManyArgs: Array<{ where: { payload: { not: unknown } }; select: unknown }> = [];
  const updateArgs: Array<{ where: { id: string }; data: { payload: unknown } }> = [];
  const db = {
    ebayOrderImport: {
      async findMany(args: (typeof findManyArgs)[number]) {
        calls.reads++;
        findManyArgs.push(args);
        const not = args.where.payload.not;
        return rows
          .filter((row) => row.payload !== null && (not === Prisma.DbNull || row.payload !== STORED_JSON_NULL))
          .map((row) => ({ id: row.id, payload: row.payload === STORED_JSON_NULL ? null : row.payload }));
      },
      async update(args: (typeof updateArgs)[number]) {
        calls.updates++;
        updateArgs.push(args);
        const payload = args.data.payload;
        const row = rows.find((candidate) => candidate.id === args.where.id)!;
        if (payload === Prisma.DbNull) row.payload = null;
        else if (payload === null || payload === Prisma.JsonNull) row.payload = STORED_JSON_NULL;
        else row.payload = payload;
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
    calls, rows, db, findManyArgs, updateArgs,
    get failedKeyLookups() { return failedKeyLookups; },
    signedRequest(message: unknown) {
      const body = JSON.stringify(message);
      const signature = sign("sha256", Buffer.from(body), privateKey).toString("base64");
      const header = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: keyId, signature, digest: "SHA256" })).toString("base64");
      return postRequest(body, { "x-ebay-signature": header });
    },
  };
}
