import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  accountDeletionVerificationToken,
  buildAccountDeletionChallengeResponse,
  decodeEbaySignatureHeader,
  EBAY_ACCOUNT_DELETION_ENDPOINT,
  readEbayAccountDeletionIdentifiers,
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

test("account deletion identifiers are topic-bound and trimmed", () => {
  const message = {
    metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
    notification: { data: { userId: "user-1", username: " buyer-1 ", eiasToken: "token-1" } },
  };
  assert.deepEqual(readEbayAccountDeletionIdentifiers(message), ["user-1", "buyer-1", "token-1"]);
  assert.deepEqual(readEbayAccountDeletionIdentifiers({ ...message, metadata: { topic: "OTHER" } }), []);
  assert.deepEqual(readEbayAccountDeletionIdentifiers({ ...message, notification: { data: { userId: " " } } }), []);
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
