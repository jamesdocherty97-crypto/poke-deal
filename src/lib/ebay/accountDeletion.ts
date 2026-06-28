import { createHash } from "node:crypto";

export const EBAY_ACCOUNT_DELETION_ENDPOINT = "https://poke-deal.vercel.app/api/ebay/account-deletion";

export function accountDeletionVerificationToken(env: Record<string, string | undefined> = process.env): string | null {
  const token = env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN?.trim();
  return token && /^[A-Za-z0-9_-]{32,80}$/.test(token) ? token : null;
}

export function buildAccountDeletionChallengeResponse(input: {
  challengeCode: string;
  verificationToken: string;
  endpoint: string;
}): string {
  const hash = createHash("sha256");
  hash.update(input.challengeCode);
  hash.update(input.verificationToken);
  hash.update(input.endpoint);
  return hash.digest("hex");
}
