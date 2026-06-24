// eBay OAuth 2.0 helpers.
// Builds authorization consent URLs and exchanges authorization codes for tokens.
// Never logs token values.

import type { EbayConfig } from "./config.js";

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
].join(" ");

export interface EbayTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  token_type: string;
}

/** Build the eBay OAuth consent URL. The redirect_uri param must be the RuName, not the raw URL. */
export function buildAuthUrl(config: EbayConfig, state = "ebay-connect"): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.ruName,
    response_type: "code",
    scope: EBAY_SCOPES,
    state,
  });
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
  const response = await fetchImpl(config.tokenUrl, {
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
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: EBAY_SCOPES,
  });
  const response = await fetchImpl(config.tokenUrl, {
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
