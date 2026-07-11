import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const EBAY_OAUTH_STATE_COOKIE = "poke_deal_ebay_oauth_state";
const STATE_MAX_AGE_SECONDS = 10 * 60;

export function createEbayOauthState(secret: string, nonce = randomBytes(32).toString("base64url")): string {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) throw new Error("Invalid eBay OAuth state nonce");
  return `${nonce}.${signNonce(nonce, secret)}`;
}

export function verifyEbayOauthState(request: Request, secret: string): { ok: true } | { ok: false; error: string } {
  const returned = new URL(request.url).searchParams.get("state")?.trim() ?? "";
  const cookie = readCookie(request.headers.get("cookie"), EBAY_OAUTH_STATE_COOKIE);
  if (!returned || !cookie) return { ok: false, error: "Missing eBay OAuth state or state cookie." };
  if (!safeEqual(returned, cookie)) return { ok: false, error: "eBay OAuth state did not match this browser session." };
  const separator = returned.lastIndexOf(".");
  if (separator <= 0) return { ok: false, error: "Invalid eBay OAuth state." };
  const nonce = returned.slice(0, separator);
  const signature = returned.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(nonce) || !safeEqual(signature, signNonce(nonce, secret))) {
    return { ok: false, error: "Invalid eBay OAuth state signature." };
  }
  return { ok: true };
}

export function ebayOauthStateCookie(state: string, secure = true): string {
  return [
    `${EBAY_OAUTH_STATE_COOKIE}=${state}`,
    "Path=/api/ebay/oauth",
    `Max-Age=${STATE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearEbayOauthStateCookie(secure = true): string {
  return [
    `${EBAY_OAUTH_STATE_COOKIE}=`,
    "Path=/api/ebay/oauth",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function signNonce(nonce: string, secret: string): string {
  return createHmac("sha256", secret).update("poke-deal:ebay-oauth-state:v1\0").update(nonce).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    const value = rest.join("=").trim();
    return value || null;
  }
  return null;
}
