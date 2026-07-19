const ACCESS_TOKEN_MIN_LENGTH = 43;
const ACCESS_TOKEN_MAX_LENGTH = 256;
const SESSION_VERSION = "v1";

export const APP_ACCESS_COOKIE = "__Host-poke-deal-access";
export const APP_ACCESS_SESSION_TTL_SECONDS = 60 * 60 * 24 * 180;

type AccessEnvironment = Record<string, string | undefined>;

export interface PasswordlessAccessConfig {
  accessToken: string;
  sessionSecret: string;
}

function readBoundedSecret(value: string | undefined): string | null {
  const secret = value?.trim() ?? "";
  if (secret.length < ACCESS_TOKEN_MIN_LENGTH || secret.length > ACCESS_TOKEN_MAX_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) return null;
  return secret;
}

export function readPasswordlessAccessConfig(
  env: AccessEnvironment = process.env,
): PasswordlessAccessConfig | null {
  // The access link is an alternative way through an already configured gate,
  // never a replacement for production's fail-closed APP_PASSWORD invariant.
  if (!env.APP_PASSWORD?.trim()) return null;

  const accessToken = readBoundedSecret(env.APP_ACCESS_TOKEN);
  const sessionSecret = readBoundedSecret(env.APP_SESSION_SECRET);
  if (!accessToken || !sessionSecret || accessToken === sessionSecret) return null;
  return { accessToken, sessionSecret };
}

export function hasPasswordlessAccessConfig(env: AccessEnvironment = process.env): boolean {
  return readPasswordlessAccessConfig(env) !== null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function isValidAccessToken(provided: unknown, expected: string): Promise<boolean> {
  if (typeof provided !== "string") return false;
  if (provided.length < ACCESS_TOKEN_MIN_LENGTH || provided.length > ACCESS_TOKEN_MAX_LENGTH) {
    return false;
  }
  const [providedDigest, expectedDigest] = await Promise.all([sha256(provided), sha256(expected)]);
  return constantTimeBytesEqual(providedDigest, expectedDigest);
}

async function sessionSignature(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createAccessSession(
  secret: string,
  nowMs = Date.now(),
): Promise<string> {
  const expiresAt = Math.floor(nowMs / 1000) + APP_ACCESS_SESSION_TTL_SECONDS;
  const payload = `${SESSION_VERSION}.${expiresAt}`;
  return `${payload}.${await sessionSignature(payload, secret)}`;
}

export async function isValidAccessSession(
  value: string | undefined,
  secret: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!value || value.length > 256) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_VERSION || !/^\d{10}$/u.test(parts[1] ?? "")) {
    return false;
  }

  const expiresAt = Number(parts[1]);
  const now = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  // Reject cookies claiming a lifetime beyond the server-issued maximum.
  if (expiresAt > now + APP_ACCESS_SESSION_TTL_SECONDS) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expected = await sessionSignature(payload, secret);
  const [providedDigest, expectedDigest] = await Promise.all([
    sha256(parts[2] ?? ""),
    sha256(expected),
  ]);
  return constantTimeBytesEqual(providedDigest, expectedDigest);
}
