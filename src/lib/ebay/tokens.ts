// Access token management.
// Uses EBAY_REFRESH_TOKEN to mint short-lived access tokens on demand.
// In-memory cache reuses valid tokens within the same lambda invocation.

import type { EbayConfig } from "./config.js";
import { refreshAccessToken } from "./oauth.js";

interface TokenCache {
  value: string;
  expiresAt: number; // Unix ms
}

let cache: TokenCache | null = null;

export async function getAccessToken(
  config: EbayConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const now = Date.now();
  // Leave a 90-second buffer before expiry
  if (cache && cache.expiresAt > now + 90_000) {
    return cache.value;
  }
  const refreshToken = process.env.EBAY_REFRESH_TOKEN?.trim();
  if (!refreshToken) {
    throw new Error(
      "EBAY_REFRESH_TOKEN is not set. Visit /api/ebay/connect to complete OAuth.",
    );
  }
  const tokens = await refreshAccessToken(config, refreshToken, fetchImpl);
  cache = {
    value: tokens.access_token,
    expiresAt: now + tokens.expires_in * 1000,
  };
  return cache.value;
}

/** Clear the in-memory cache — for tests only. */
export function clearTokenCache(): void {
  cache = null;
}
