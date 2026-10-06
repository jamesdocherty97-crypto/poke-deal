import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  accountDeletionVerificationToken,
  buildAccountDeletionChallengeResponse,
  decodeEbaySignatureHeader,
  EBAY_ACCOUNT_DELETION_ENDPOINT,
  type EbayDeletionDb,
  readEbayAccountDeletionIdentifiers,
  scrubDeletedEbayAccountPayloads,
  verifyEbayNotificationPayload,
} from "./accountDeletion.js";
import { isEbayAccountDeletionCallbackPath, isEbayOauthCallbackPath } from "./callbackPath.js";

const STORED_JSON_NULL = Symbol("stored JSON null");

test("buildAccountDeletionChallengeResponse hashes challenge, token, endpoint in eBay order", () => {
  const challengeCode = "abc123";
  const verificationToken = "token_123456789012345678901234567890";
  const endpoint = EBAY_ACCOUNT_DELETION_ENDPOINT;

  const expected = createHash("sha256")
    .update(challengeCode)
    .update(verificationToken)
    .update(endpoint)
    .digest("hex");

  assert.equal(
    buildAccountDeletionChallengeResponse({ challengeCode, verificationToken, endpoint }),
    expected,
  );
});

test("account deletion callback exemption is exact", () => {
  assert.equal(isEbayAccountDeletionCallbackPath("/api/ebay/account-deletion"), true);
  assert.equal(isEbayAccountDeletionCallbackPath("/api/ebay/status"), false);
  assert.equal(isEbayAccountDeletionCallbackPath("/api/ebay/account-deletion/other"), false);
});

test("OAuth callback exemptions are exact and exclude other eBay routes", () => {
  assert.equal(isEbayOauthCallbackPath("/api/ebay/oauth"), true);
  assert.equal(isEbayOauthCallbackPath("/api/ebay/oauth/callback"), true);
  assert.equal(isEbayOauthCallbackPath("/api/ebay/oauth/other"), false);
  assert.equal(isEbayOauthCallbackPath("/api/ebay/status"), false);
});

test("eBay notification ECC signatures are decoded and verified before processing", () => {
  const message = {
    metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
    notification: { notificationId: "notification-1", data: { userId: "user-1", username: "buyer-1" } },
  };
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signatureValue = sign("sha256", Buffer.from(JSON.stringify(message)), privateKey).toString("base64");
  const header = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "key-1", signature: signatureValue, digest: "SHA256" })).toString("base64");
  const decoded = decodeEbaySignatureHeader(header);

  assert.ok(decoded);
  assert.equal(
    verifyEbayNotificationPayload(message, decoded, publicKey.export({ type: "spki", format: "pem" }).toString()),
    true,
  );
  assert.equal(
    verifyEbayNotificationPayload({ ...message, tampered: true }, decoded, publicKey.export({ type: "spki", format: "pem" }).toString()),
    false,
  );
});

test("account deletion identifiers are topic-bound and historical matching payloads are scrubbed idempotently", async () => {
  const message = {
    metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
    notification: { data: { userId: "user-1", username: "buyer-1", eiasToken: "token-1" } },
  };
  const identifiers = readEbayAccountDeletionIdentifiers(message);
  const { db, rows } = fakeDeletionDb();

  assert.deepEqual(identifiers, ["user-1", "buyer-1", "token-1"]);
  assert.equal(await scrubDeletedEbayAccountPayloads(db, identifiers), 1);
  assert.equal(await scrubDeletedEbayAccountPayloads(db, identifiers), 0);
  assert.notEqual(rows[0]?.payload, STORED_JSON_NULL, "the cleared payload must not be a stored JSON null");
  assert.equal(rows[0]?.payload, null, "the cleared payload must be a database NULL");
  assert.deepEqual(rows[1]?.payload, { order: { orderId: "order-2" } });
  assert.equal(rows[2]?.payload, STORED_JSON_NULL, "a row that already holds JSON null is left alone");
});

test("scrub passes Prisma null sentinels for the Json payload column, never plain null", async () => {
  // Prisma 5.22 does not reject plain `null` for a nullable Json column: it
  // quietly reads it as JSON null. These assertions pin the exact arguments.
  const { db, findManyCalls, updateCalls } = fakeDeletionDb();

  assert.equal(await scrubDeletedEbayAccountPayloads(db, ["buyer-1"]), 1);

  assert.equal(findManyCalls.length, 1);
  assert.notEqual(findManyCalls[0].where.payload.not, null, "the payload filter must not be plain null");
  assert.equal(findManyCalls[0].where.payload.not, Prisma.AnyNull, "the payload filter must be Prisma.AnyNull");
  assert.deepEqual(findManyCalls[0].select, { id: true, payload: true });

  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0].where, { id: "import-1" });
  assert.deepEqual(Object.keys(updateCalls[0].data), ["payload"]);
  assert.notEqual(updateCalls[0].data.payload, null, "the payload clear must not be plain null");
  assert.equal(updateCalls[0].data.payload, Prisma.DbNull, "the payload clear must be Prisma.DbNull");
});

test("scrub issues no Prisma calls when there are no identifiers", async () => {
  const { db, findManyCalls, updateCalls } = fakeDeletionDb();

  assert.equal(await scrubDeletedEbayAccountPayloads(db, []), 0);
  assert.equal(await scrubDeletedEbayAccountPayloads(db, [""]), 0);
  assert.equal(findManyCalls.length, 0);
  assert.equal(updateCalls.length, 0);
});

test("scrub round trip on a real Prisma client clears matching payloads to a database NULL", async (context) => {
  const databaseUrl = disposableCiDatabaseUrl();
  if (!databaseUrl) {
    context.skip("no disposable CI database (needs CI=true and a loopback DATABASE_URL); scrub round-trip skipped cleanly");
    return;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const tag = `scrub-dbnull-${randomUUID()}`;
  const identifier = `${tag}-buyer`;
  const keysWhere = async (payload: Prisma.JsonNullableFilter<"EbayOrderImport">) =>
    (await prisma.ebayOrderImport.findMany({ where: { orderId: tag, payload }, select: { importKey: true } }))
      .map((row) => row.importKey.slice(tag.length + 1))
      .sort();
  try {
    await prisma.ebayOrderImport.createMany({
      data: [
        { importKey: `${tag}-match`, orderId: tag, payload: { order: { buyer: { username: identifier } } } },
        { importKey: `${tag}-other`, orderId: tag, payload: { order: { buyer: { username: `${identifier}-0` } } } },
        { importKey: `${tag}-dbnull`, orderId: tag, payload: Prisma.DbNull },
        { importKey: `${tag}-jsonnull`, orderId: tag, payload: Prisma.JsonNull },
      ],
    });

    // AnyNull skips both kinds of null; DbNull would still read the JSON null.
    assert.deepEqual(await keysWhere({ not: Prisma.AnyNull }), ["match", "other"]);
    assert.deepEqual(await keysWhere({ not: Prisma.DbNull }), ["jsonnull", "match", "other"]);

    assert.equal(await scrubDeletedEbayAccountPayloads(prisma, [identifier]), 1);
    assert.equal(await scrubDeletedEbayAccountPayloads(prisma, [identifier]), 0);

    // The matching row is now a database NULL, not a stored JSON null.
    assert.deepEqual(await keysWhere({ equals: Prisma.DbNull }), ["dbnull", "match"]);
    assert.deepEqual(await keysWhere({ equals: Prisma.JsonNull }), ["jsonnull"]);
    assert.deepEqual(await keysWhere({ not: Prisma.AnyNull }), ["other"]);
  } finally {
    await prisma.ebayOrderImport.deleteMany({ where: { orderId: tag } });
    await prisma.$disconnect();
  }
});

test("accountDeletionVerificationToken only accepts eBay-compatible token values", () => {
  assert.equal(
    accountDeletionVerificationToken({
      EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN: "valid-token_12345678901234567890",
    }),
    "valid-token_12345678901234567890",
  );
  assert.equal(
    accountDeletionVerificationToken({
      EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN: "too short",
    }),
    null,
  );
  assert.equal(
    accountDeletionVerificationToken({
      EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN: "invalid.token.12345678901234567890",
    }),
    null,
  );
});

// In-memory stand-in for the two delegate methods the scrub uses. It keeps the
// distinction Postgres keeps for a nullable Json column: a stored `null` is a
// database NULL and STORED_JSON_NULL is a stored JSON `null`. Plain `null` is
// modelled as Prisma 5.22 was observed to treat it on the CI database: it is
// not rejected, it is read as JSON null in both the filter and the write.
function fakeDeletionDb() {
  const rows: Array<{ id: string; payload: unknown }> = [
    { id: "import-1", payload: { order: { buyer: { username: "buyer-1" } } } },
    { id: "import-2", payload: { order: { orderId: "order-2" } } },
    { id: "import-3", payload: STORED_JSON_NULL },
  ];
  const findManyCalls: any[] = [];
  const updateCalls: any[] = [];
  const delegate = {
    async findMany(args: any) {
      findManyCalls.push(args);
      const not = args.where.payload.not;
      if (not !== Prisma.DbNull && not !== Prisma.AnyNull && not !== null) {
        throw new Error("fakeDeletionDb only models `not` with DbNull, AnyNull or plain null");
      }
      return rows
        .filter((row) => row.payload !== null && (not === Prisma.DbNull || row.payload !== STORED_JSON_NULL))
        .map((row) => ({ id: row.id, payload: row.payload === STORED_JSON_NULL ? null : row.payload }));
    },
    async update(args: any) {
      updateCalls.push(args);
      const payload = args.data.payload;
      const row = rows.find((candidate) => candidate.id === args.where.id)!;
      if (payload === Prisma.DbNull) row.payload = null;
      else if (payload === null || payload === Prisma.JsonNull) row.payload = STORED_JSON_NULL;
      else row.payload = payload;
      return row;
    },
  };
  return { db: { ebayOrderImport: delegate } as unknown as EbayDeletionDb, rows, findManyCalls, updateCalls };
}

// The round-trip test writes rows, so it only ever runs against the throwaway
// Postgres service that CI starts on loopback; never a developer or hosted DB.
function disposableCiDatabaseUrl(): string | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || process.env.CI !== "true") return null;
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname) ? databaseUrl : null;
  } catch {
    return null;
  }
}
