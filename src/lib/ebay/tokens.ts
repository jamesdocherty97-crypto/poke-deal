// Access token management.
// Uses the stored eBay refresh token to mint short-lived access tokens on demand.
// In-memory cache reuses valid tokens within the same lambda invocation.

import type { EbayConfig } from "./config.js";
import {
  markEbayCredentialValidated,
  refreshTokenFingerprint,
  resolveEbayRefreshToken,
  type EbayRefreshTokenSource,
  type ResolvedEbayRefreshToken,
} from "./credentials.js";
import { fetchApplicationAccessToken, refreshAccessToken } from "./oauth.js";

interface TokenCache {
  value: string;
  expiresAt: number; // Unix ms
  refreshTokenFingerprint: string;
  refreshTokenSource: EbayRefreshTokenSource;
}

interface ApplicationTokenCache {
  value: string;
  expiresAt: number; // Unix ms
}

let cache: TokenCache | null = null;
let applicationCache: ApplicationTokenCache | null = null;

export async function getAccessToken(
  config: EbayConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  return (await getAccessTokenWithSource(config, fetchImpl)).accessToken;
}

export async function getAccessTokenWithSource(
  config: EbayConfig,
  fetchImpl: typeof fetch = fetch,
  options: { refreshToken?: ResolvedEbayRefreshToken | null } = {},
): Promise<{ accessToken: string; tokenSource: EbayRefreshTokenSource }> {
  const now = Date.now();
  const refreshToken = options.refreshToken ?? await resolveEbayRefreshToken();
  if (!refreshToken) {
    throw new Error(
      "eBay refresh token is not set. Visit /api/ebay/connect to complete OAuth.",
    );
  }
  const fingerprint = refreshTokenFingerprint(refreshToken.token);

  // Leave a 90-second buffer before expiry
  if (
    cache &&
    cache.expiresAt > now + 90_000 &&
    cache.refreshTokenFingerprint === fingerprint &&
    cache.refreshTokenSource === refreshToken.source
  ) {
    return { accessToken: cache.value, tokenSource: cache.refreshTokenSource };
  }
  const tokens = await refreshAccessToken(config, refreshToken.token, fetchImpl);
  cache = {
    value: tokens.access_token,
    expiresAt: now + tokens.expires_in * 1000,
    refreshTokenFingerprint: fingerprint,
    refreshTokenSource: refreshToken.source,
  };
  if (refreshToken.source === "db" && !options.refreshToken) await markEbayCredentialValidated();
  return { accessToken: cache.value, tokenSource: refreshToken.source };
}

export async function getApplicationAccessToken(
  config: EbayConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const now = Date.now();
  if (applicationCache && applicationCache.expiresAt > now + 90_000) {
    return applicationCache.value;
  }
  const tokens = await fetchApplicationAccessToken(config, fetchImpl);
  applicationCache = {
    value: tokens.access_token,
    expiresAt: now + tokens.expires_in * 1000,
  };
  return tokens.access_token;
}

/** Clear the in-memory cache — for tests only. */
export function clearTokenCache(): void {
  cache = null;
  applicationCache = null;
}
