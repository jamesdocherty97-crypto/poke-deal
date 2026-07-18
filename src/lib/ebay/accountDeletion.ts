import { createHash, createVerify } from "node:crypto";
import type { EbayConfig } from "./config.js";
import { ebayJson } from "./client.js";
import { getApplicationAccessToken } from "./tokens.js";

export const EBAY_ACCOUNT_DELETION_ENDPOINT = "https://poke-deal.vercel.app/api/ebay/account-deletion";
const PUBLIC_KEY_CACHE_MS = 60 * 60 * 1000;

type EbaySignatureEnvelope = {
  alg: string;
  kid: string;
  signature: string;
  digest: string;
};

type EbayNotificationPublicKey = {
  key?: unknown;
  algorithm?: unknown;
  digest?: unknown;
};

type PublicKeyCacheEntry = { key: string; expiresAt: number };
const publicKeyCache = new Map<string, PublicKeyCacheEntry>();

export type EbayAccountDeletionNotification = {
  metadata?: { topic?: unknown };
  notification?: {
    notificationId?: unknown;
    data?: { userId?: unknown; username?: unknown; eiasToken?: unknown };
  };
};

type EbayDeletionDb = {
  ebayOrderImport: {
    findMany(args: unknown): Promise<Array<{ id: string; payload: unknown }>>;
    update(args: unknown): Promise<unknown>;
  };
};

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

export async function verifyEbayNotificationSignature(input: {
  message: unknown;
  signatureHeader: string;
  config: EbayConfig;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const signature = decodeEbaySignatureHeader(input.signatureHeader);
  if (!signature) return false;
  const publicKey = await getEbayNotificationPublicKey(
    input.config,
    signature.kid,
    input.fetchImpl ?? fetch,
  );
  return verifyEbayNotificationPayload(input.message, signature, publicKey);
}

export function decodeEbaySignatureHeader(value: string): EbaySignatureEnvelope | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Partial<EbaySignatureEnvelope>;
    if (!parsed.alg || !parsed.kid || !parsed.signature || !parsed.digest) return null;
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(parsed.kid)) return null;
    return {
      alg: parsed.alg,
      kid: parsed.kid,
      signature: parsed.signature,
      digest: parsed.digest,
    };
  } catch {
    return null;
  }
}

export function verifyEbayNotificationPayload(
  message: unknown,
  signature: EbaySignatureEnvelope,
  publicKey: string,
): boolean {
  if (!/^ecdsa$/i.test(signature.alg)) return false;
  const digest = signature.digest.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const algorithm = digest === "sha256" ? "sha256" : digest === "sha1" ? "ssl3-sha1" : null;
  if (!algorithm) return false;

  try {
    const verifier = createVerify(algorithm);
    verifier.update(JSON.stringify(message));
    verifier.end();
    return verifier.verify(formatEbayPublicKey(publicKey), signature.signature, "base64");
  } catch {
    return false;
  }
}

export function readEbayAccountDeletionIdentifiers(message: EbayAccountDeletionNotification): string[] {
  if (message.metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION") return [];
  const data = message.notification?.data;
  return [data?.userId, data?.username, data?.eiasToken]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

/**
 * Remove historical raw provider payloads that contain the deleted account's
 * identifiers. Normalized seller ledger facts remain; new imports no longer
 * persist the full provider order object.
 */
export async function scrubDeletedEbayAccountPayloads(
  db: EbayDeletionDb,
  identifiers: string[],
): Promise<number> {
  const needles = new Set(identifiers.filter(Boolean));
  if (needles.size === 0) return 0;
  const rows = await db.ebayOrderImport.findMany({
    where: { payload: { not: null } },
    select: { id: true, payload: true },
  });
  const affected = rows.filter((row) => jsonContainsExactString(row.payload, needles));
  await Promise.all(affected.map((row) => db.ebayOrderImport.update({
    where: { id: row.id },
    data: { payload: null },
  })));
  return affected.length;
}

async function getEbayNotificationPublicKey(
  config: EbayConfig,
  keyId: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const cacheKey = `${config.env}:${keyId}`;
  const cached = publicKeyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const accessToken = await getApplicationAccessToken(config, fetchImpl);
  const payload = await ebayJson<EbayNotificationPublicKey>(
    config,
    `/commerce/notification/v1/public_key/${encodeURIComponent(keyId)}`,
    accessToken,
    { method: "GET" },
    fetchImpl,
  );
  if (typeof payload.key !== "string" || !payload.key.includes("PUBLIC KEY")) {
    throw new Error("eBay Notification API returned an invalid public key");
  }
  const key = formatEbayPublicKey(payload.key);
  publicKeyCache.set(cacheKey, { key, expiresAt: Date.now() + PUBLIC_KEY_CACHE_MS });
  return key;
}

function formatEbayPublicKey(key: string): string {
  return key
    .replace(/-----BEGIN PUBLIC KEY-----\s*/, "-----BEGIN PUBLIC KEY-----\n")
    .replace(/\s*-----END PUBLIC KEY-----/, "\n-----END PUBLIC KEY-----");
}

function jsonContainsExactString(value: unknown, needles: Set<string>): boolean {
  if (typeof value === "string") return needles.has(value);
  if (Array.isArray(value)) return value.some((item) => jsonContainsExactString(item, needles));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => jsonContainsExactString(item, needles));
  }
  return false;
}
