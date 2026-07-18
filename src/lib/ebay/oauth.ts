// eBay OAuth 2.0 helpers.
// Builds authorization consent URLs and exchanges authorization codes for tokens.
// Never logs token values.

import type { EbayConfig } from "./config.js";
import { boundedEbayFetch } from "./client.js";

export const EBAY_RECONNECT_HINT = "Reconnect eBay to grant new permissions — /api/ebay/connect";

export const EBAY_USER_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
] as const;

export const EBAY_SCOPES = EBAY_USER_SCOPES.join(" ");

export interface EbayTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  token_type: string;
}

/** Build the eBay OAuth consent URL. The redirect_uri param must be the RuName, not the raw URL. */
export function buildAuthUrl(config: EbayConfig, state: string, options: { forceLogin?: boolean } = {}): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.ruName,
    response_type: "code",
    scope: EBAY_SCOPES,
    state,
  });
  if (options.forceLogin) params.set("prompt", "login");
  return `${config.authBaseUrl}/oauth2/authorize?${params.toString()}`;
}

function basicCredentials(config: EbayConfig): string {
  return Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
}

export async function exchangeCodeForTokens(
  config: EbayConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.ruName,
  });
  const response = await boundedEbayFetch(fetchImpl, config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicCredentials(config)}`,
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "(unreadable)");
    throw new Error(`eBay token exchange failed ${response.status}: ${text}`);
  }
  return (await response.json()) as EbayTokenResponse;
}

export async function refreshAccessToken(
  config: EbayConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayTokenResponse> {
  // eBay defaults a refresh to the scopes granted during consent. Omitting
  // `scope` keeps older valid tokens usable when this app's requested scopes
  // change; a capability that was never granted still fails at the API call
  // with the existing reconnect guidance.
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await boundedEbayFetch(fetchImpl, config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicCredentials(config)}`,
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "(unreadable)");
    throw new Error(`eBay token refresh failed ${response.status}: ${text}`);
  }
  return (await response.json()) as EbayTokenResponse;
}

export async function fetchApplicationAccessToken(
  config: EbayConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });
  const response = await boundedEbayFetch(fetchImpl, config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicCredentials(config)}`,
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "(unreadable)");
    throw new Error(`eBay application token failed ${response.status}: ${text}`);
  }
  return (await response.json()) as EbayTokenResponse;
}
