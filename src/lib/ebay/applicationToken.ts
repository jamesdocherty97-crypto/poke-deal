// Application (client-credentials) access token for eBay APIs that act as the
// app rather than the seller, such as notification public keys and Browse.
// Kept apart from tokens.ts so callers like the account-deletion webhook do
// not load the seller-credential store, and with it the database client.

import type { EbayConfig } from "./config.js";
import { fetchApplicationAccessToken } from "./oauth.js";

interface ApplicationTokenCache {
  value: string;
  expiresAt: number; // Unix ms
}

let applicationCache: ApplicationTokenCache | null = null;

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
export function clearApplicationTokenCache(): void {
  applicationCache = null;
}
