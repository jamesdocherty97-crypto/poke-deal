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
  const { db, rows } = fakeDeletionDb({ strict: true });

  assert.deepEqual(identifiers, ["user-1", "buyer-1", "token-1"]);
  assert.equal(await scrubDeletedEbayAccountPayloads(db, identifiers), 1);
  assert.equal(await scrubDeletedEbayAccountPayloads(db, identifiers), 0);
  assert.equal(rows[0]?.payload, null);
  assert.notEqual(rows[1]?.payload, null);
});

test("scrub passes Prisma null sentinels for the Json payload column, never plain null", async () => {
  // Prisma 5 rejects plain `null` for a nullable Json column in both filters
  // and writes. The recording fake accepts anything, so these assertions pin
  // the exact arguments sent to Prisma.
  const { db, findManyCalls, updateCalls } = fakeDeletionDb({ strict: false });

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
  const { db, findManyCalls, updateCalls } = fakeDeletionDb({ strict: true });

  assert.equal(await scrubDeletedEbayAccountPayloads(db, []), 0);
  assert.equal(await scrubDeletedEbayAccountPayloads(db, [""]), 0);
  assert.equal(findManyCalls.length, 0);
  assert.equal(updateCalls.length, 0);
});

test("scrub runs against a real Prisma client: sentinels are accepted and plain null is rejected", async (context) => {
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

    // The original bug: Prisma itself refuses plain null for this column.
    await assert.rejects(
      async () => prisma.ebayOrderImport.findMany({ where: { orderId: tag, payload: { not: null as never } } }),
      Prisma.PrismaClientValidationError,
    );
    await assert.rejects(
      async () => prisma.ebayOrderImport.updateMany({ where: { orderId: tag }, data: { payload: null as never } }),
      Prisma.PrismaClientValidationError,
    );

    assert.deepEqual(await keysWhere({ not: Prisma.AnyNull }), ["match", "other"]);
    assert.equal(await scrubDeletedEbayAccountPayloads(prisma, [identifier]), 1);
    assert.equal(await scrubDeletedEbayAccountPayloads(prisma, [identifier]), 0);
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

// In-memory stand-in for the two delegate methods the scrub uses. A stored
// `null` models a database NULL. With `strict` it mirrors Prisma 5 for the
// nullable Json `payload` column: plain `null` is rejected and only the null
// sentinels are understood. Without it, it only records the arguments.
function fakeDeletionDb(options: { strict: boolean }) {
  const rows: Array<{ id: string; payload: unknown }> = [
    { id: "import-1", payload: { order: { buyer: { username: "buyer-1" } } } },
    { id: "import-2", payload: { order: { orderId: "order-2" } } },
  ];
  const findManyCalls: any[] = [];
  const updateCalls: any[] = [];
  const isNullSentinel = (value: unknown) =>
    value === Prisma.DbNull || value === Prisma.JsonNull || value === Prisma.AnyNull;
  const delegate = {
    async findMany(args: any) {
      findManyCalls.push(args);
      if (options.strict && !isNullSentinel(args.where.payload.not)) {
        throw new Error("Argument `not` must not be null.");
      }
      return rows.filter((row) => row.payload !== null);
    },
    async update(args: any) {
      updateCalls.push(args);
      const payload = args.data.payload;
      if (options.strict && payload === null) throw new Error("Argument `payload` must not be null.");
      const row = rows.find((candidate) => candidate.id === args.where.id)!;
      row.payload = payload === null || isNullSentinel(payload) ? null : payload;
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
