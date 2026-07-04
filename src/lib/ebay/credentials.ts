import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getPrisma } from "../db/prisma.js";
import type { EbayConfig } from "./config.js";

export type EbayRefreshTokenSource = "db" | "env";

export type ResolvedEbayRefreshToken = {
  token: string;
  source: EbayRefreshTokenSource;
};

export type EbayCredentialRow = {
  id: string;
  key: string;
  env: string;
  marketplaceId: string;
  refreshTokenCiphertext: string;
  refreshTokenIv: string;
  refreshTokenTag: string;
  refreshTokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastValidatedAt: Date | null;
};

export type EbayCredentialDb = {
  ebayCredential: {
    findUnique(args: { where: { key: string } }): Promise<EbayCredentialRow | null>;
    upsert(args: {
      where: { key: string };
      create: {
        key: string;
        env: string;
        marketplaceId: string;
        refreshTokenCiphertext: string;
        refreshTokenIv: string;
        refreshTokenTag: string;
        refreshTokenExpiresAt?: Date;
      };
      update: {
        env: string;
        marketplaceId: string;
        refreshTokenCiphertext: string;
        refreshTokenIv: string;
        refreshTokenTag: string;
        refreshTokenExpiresAt?: Date | null;
      };
    }): Promise<EbayCredentialRow>;
    update(args: { where: { key: string }; data: { lastValidatedAt: Date } }): Promise<EbayCredentialRow>;
  };
};

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
};

const DEFAULT_CREDENTIAL_KEY = "default";
const AES_GCM_IV_BYTES = 12;

export function encryptSecret(plaintext: string, key = readTokenEncryptionKey()): EncryptedSecret {
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret, key = readTokenEncryptionKey()): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

type EnvLike = Record<string, string | undefined>;

export function readTokenEncryptionKey(env: EnvLike = process.env): Buffer {
  const raw = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set.");

  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32 && base64.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) return base64;

  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");

  throw new Error("TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as base64 or hex.");
}

export async function persistEbayRefreshToken(
  config: EbayConfig,
  refreshToken: string,
  input: {
    db?: EbayCredentialDb;
    env?: EnvLike;
    refreshTokenExpiresInSeconds?: number;
    now?: Date;
  } = {},
): Promise<EbayCredentialRow> {
  const token = refreshToken.trim();
  if (!token) throw new Error("eBay did not return a refresh token.");
  const now = input.now ?? new Date();
  const encrypted = encryptSecret(token, readTokenEncryptionKey(input.env ?? process.env));
  const refreshTokenExpiresAt = input.refreshTokenExpiresInSeconds
    ? new Date(now.getTime() + input.refreshTokenExpiresInSeconds * 1000)
    : undefined;
  const db = input.db ?? (getPrisma() as unknown as EbayCredentialDb);

  return db.ebayCredential.upsert({
    where: { key: DEFAULT_CREDENTIAL_KEY },
    create: {
      key: DEFAULT_CREDENTIAL_KEY,
      env: config.env,
      marketplaceId: config.marketplaceId,
      refreshTokenCiphertext: encrypted.ciphertext,
      refreshTokenIv: encrypted.iv,
      refreshTokenTag: encrypted.tag,
      ...(refreshTokenExpiresAt ? { refreshTokenExpiresAt } : {}),
    },
    update: {
      env: config.env,
      marketplaceId: config.marketplaceId,
      refreshTokenCiphertext: encrypted.ciphertext,
      refreshTokenIv: encrypted.iv,
      refreshTokenTag: encrypted.tag,
      refreshTokenExpiresAt: refreshTokenExpiresAt ?? null,
    },
  });
}

export async function resolveEbayRefreshToken(
  input: {
    db?: EbayCredentialDb | null;
    env?: EnvLike;
  } = {},
): Promise<ResolvedEbayRefreshToken | null> {
  const env = input.env ?? process.env;
  const db = input.db === undefined
    ? env.DATABASE_URL
      ? (getPrisma() as unknown as EbayCredentialDb)
      : null
    : input.db;
  if (db) {
    const row = await db.ebayCredential.findUnique({ where: { key: DEFAULT_CREDENTIAL_KEY } });
    if (row) {
      return {
        token: decryptSecret({
          ciphertext: row.refreshTokenCiphertext,
          iv: row.refreshTokenIv,
          tag: row.refreshTokenTag,
        }, readTokenEncryptionKey(env)),
        source: "db",
      };
    }
  }

  const envToken = env.EBAY_REFRESH_TOKEN?.trim();
  return envToken ? { token: envToken, source: "env" } : null;
}

export async function markEbayCredentialValidated(
  input: { db?: EbayCredentialDb; now?: Date } = {},
): Promise<void> {
  const db = input.db ?? (process.env.DATABASE_URL ? (getPrisma() as unknown as EbayCredentialDb) : null);
  if (!db) return;
  await db.ebayCredential.update({
    where: { key: DEFAULT_CREDENTIAL_KEY },
    data: { lastValidatedAt: input.now ?? new Date() },
  }).catch(() => undefined);
}

export function refreshTokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
