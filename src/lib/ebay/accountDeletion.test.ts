import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  accountDeletionVerificationToken,
  buildAccountDeletionChallengeResponse,
  EBAY_ACCOUNT_DELETION_ENDPOINT,
} from "./accountDeletion.js";

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
