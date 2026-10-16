import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { clearTokenCache } from "../../../../lib/ebay/tokens.js";
import { GET, POST } from "./route.js";

// Route-level coverage for the eBay Marketplace Account Deletion callback.
// Synthetic provider fixtures. The callback holds no buyer data to delete, so
// every path must answer without constructing or touching a database client.

const callbackUrl = "https://callback.test/api/ebay/account-deletion";
const verificationToken = "test-token_123456789012345678901234567890";
const notification = {
  metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
  notification: { notificationId: "notification-1", data: { userId: "buyer-1", username: "buyer-name-1" } },
};
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
let nextKeyId = 0;

type Globals = typeof globalThis & { prisma?: unknown };

test("the route's import graph never reaches the database client", () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const entry = path.join(srcRoot, "app/api/ebay/account-deletion/route.ts");
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      const resolved = resolveSource(specifier, file, srcRoot);
      if (resolved) queue.push(resolved);
      else packages.add(specifier);
    }
  }
  const relativeSeen = [...seen].map((file) => path.relative(srcRoot, file));
  assert.ok(relativeSeen.includes("lib/ebay/accountDeletion.ts"), "the walk must follow the route's own imports");
  assert.deepEqual(relativeSeen.filter((file) => file.startsWith("lib/db/")), []);
  assert.deepEqual([...packages].filter((name) => name.startsWith("@prisma/") || name === "prisma"), []);
});

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
  assert.equal(fixture.calls.provider, 0);
  assert.deepEqual(fixture.dbTouches, []);
});

test("GET rejects missing challenges and unavailable verification tokens", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  for (const query of ["", "?challenge_code="]) {
    assert.equal((await GET(new Request(`${callbackUrl}${query}`))).status, 400);
  }
  for (const token of [undefined, "too-short"]) {
    if (token === undefined) delete process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN;
    else process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN = token;
    assert.equal((await GET(new Request(`${callbackUrl}?challenge_code=challenge`))).status, 503);
  }
  assert.deepEqual(fixture.dbTouches, []);
});

test("POST acknowledges a verified notification with 204 and never touches a DB client", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  for (const message of [notification, notification]) {
    const response = await POST(fixture.signedRequest(message));
    assert.equal(response.status, 204);
    assert.equal(response.body, null);
    assert.equal(await response.text(), "");
  }
  // Token plus key on the first call; both are cached for the second.
  assert.equal(fixture.calls.provider, 2);
  assert.deepEqual(fixture.dbTouches, []);
  assert.equal(fixture.infoLogs.length, 2);
  const logged = JSON.parse(fixture.infoLogs[0]!);
  assert.deepEqual(logged, { event: "ebay_account_deletion_processed", notificationId: "notification-1", storedBuyerData: "none" });
  assert.equal(fixture.infoLogs.join("\n").includes("buyer-"), false, "account identifiers are never logged");
});

test("POST rejects missing config and missing or malformed signatures", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  delete process.env.EBAY_CLIENT_ID;
  assert.equal((await POST(fixture.signedRequest(notification))).status, 503);
  process.env.EBAY_CLIENT_ID = "test-client";

  for (const signature of [undefined, " ", "invalid-base64"]) {
    const response = await POST(postRequest(JSON.stringify(notification),
      signature === undefined ? {} : { "x-ebay-signature": signature }));
    assert.equal(response.status, 412);
  }
  assert.equal(fixture.calls.provider, 0);
  assert.deepEqual(fixture.dbTouches, []);
});

test("POST rejects a tampered signed notification with 412", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  const original = fixture.signedRequest(notification);
  const response = await POST(postRequest(JSON.stringify({ ...notification, tampered: true }), {
    "x-ebay-signature": original.headers.get("x-ebay-signature")!,
  }));
  assert.equal(response.status, 412);
  assert.deepEqual(await response.json(), { error: "Invalid eBay signature." });
  assert.equal(fixture.calls.provider, 2);
  assert.deepEqual(fixture.dbTouches, []);
});

test("POST rejects signed notifications for other topics or without identifiers", { concurrency: false }, async (t) => {
  const fixture = setup(t);
  for (const message of [
    { ...notification, metadata: { topic: "OTHER_TOPIC" } },
    { ...notification, notification: { data: { userId: " " } } },
  ]) {
    assert.equal((await POST(fixture.signedRequest(message))).status, 400);
  }
  assert.deepEqual(fixture.dbTouches, []);
});

test("POST returns 503 when public-key lookup fails so eBay retries", { concurrency: false }, async (t) => {
  const fixture = setup(t, { keyLookupFails: true });
  assert.equal((await POST(fixture.signedRequest(notification))).status, 503);
  assert.equal(fixture.failedKeyLookups, 1);
  assert.deepEqual(fixture.dbTouches, []);
});

test("POST rejects malformed or oversized JSON before signature verification", { concurrency: false }, async (t) => {
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
  assert.equal(fixture.calls.provider, 0);
  assert.deepEqual(fixture.dbTouches, []);
});

function resolveSource(specifier: string, fromFile: string, srcRoot: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(srcRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  const stem = base.replace(/\.(m?js)$/, "");
  for (const candidate of [`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, path.join(stem, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Unresolved import ${specifier} from ${fromFile}`);
}

function postRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request(callbackUrl, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

function setup(t: TestContext, options: { keyLookupFails?: boolean } = {}) {
  const values: Record<string, string | undefined> = {
    EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN: verificationToken,
    EBAY_CLIENT_ID: "test-client",
    EBAY_CLIENT_SECRET: "test-secret",
    EBAY_RU_NAME: "test-redirect",
    EBAY_REDIRECT_URI: undefined,
    EBAY_ENV: "sandbox",
    // Never let a route test reach a real database.
    DATABASE_URL: undefined,
  };
  const previousEnv = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const globals = globalThis as Globals;
  const previousDb = globals.prisma;
  // The public-key cache has no reset: each fixture must use a fresh key ID.
  const keyId = `route-test-${++nextKeyId}`;
  const calls = { provider: 0 };
  const dbTouches: string[] = [];
  const infoLogs: string[] = [];
  let failedKeyLookups = 0;
  // getPrisma() returns this shared client when present, so any use of it,
  // even reading a delegate, is recorded and fails the call.
  const tripwire = new Proxy({}, {
    get(_target, property) {
      dbTouches.push(String(property));
      throw new Error("account-deletion route touched the database client");
    },
  });
  clearTokenCache();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globals.prisma = tripwire;
  t.after(() => {
    clearTokenCache();
    if (previousDb === undefined) delete globals.prisma;
    else globals.prisma = previousDb;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.method(console, "info", (line: unknown) => { infoLogs.push(String(line)); });
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
    calls, dbTouches, infoLogs,
    get failedKeyLookups() { return failedKeyLookups; },
    signedRequest(message: unknown) {
      const body = JSON.stringify(message);
      const signature = sign("sha256", Buffer.from(body), privateKey).toString("base64");
      const header = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: keyId, signature, digest: "SHA256" })).toString("base64");
      return postRequest(body, { "x-ebay-signature": header });
    },
  };
}
