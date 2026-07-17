// Identifies which eBay account is actually behind the connected OAuth
// refresh token, via the legacy Trading API's GetUser call.
//
// Why this exists: the Sell REST APIs never return the seller's username or
// email anywhere in their responses, and the Identity API
// (commerce/identity/v1/user) needs a scope
// (commerce.identity.readonly) this app's OAuth consent was never granted.
// Trading API accepts the same OAuth user access token via the
// X-EBAY-API-IAF-TOKEN header with no extra scope, and GetUser's response
// includes the UserID and Email of the account the token belongs to — the
// most direct way to confirm whether the eBay account connected to this app
// (via /api/ebay/connect) is the same account logged into the eBay website,
// or a different one (e.g. a developer sandbox/test account vs. the real
// selling account).

import type { EbayConfig } from "./config.js";
import { boundedEbayFetch } from "./client.js";

const SITE_IDS: Record<string, number> = {
  EBAY_GB: 3,
  EBAY_US: 0,
};

export interface EbayTradingUser {
  userId: string | null;
  email: string | null;
  registrationDate: string | null;
  sellerInfo: { sellerLevel?: string | null } | null;
  raw: string;
}

export async function fetchEbayTradingApiUser(
  config: EbayConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayTradingUser> {
  const tradingApiBaseUrl = config.env === "sandbox"
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";
  const siteId = SITE_IDS[config.marketplaceId] ?? 3;

  const body = `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
</GetUserRequest>`;

  const response = await boundedEbayFetch(fetchImpl, tradingApiBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "X-EBAY-API-CALL-NAME": "GetUser",
      "X-EBAY-API-SITEID": String(siteId),
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1199",
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`eBay Trading API GetUser failed: HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const userId = matchTag(text, "UserID");
  const email = matchTag(text, "Email");
  const registrationDate = matchTag(text, "RegistrationDate");
  const sellerLevel = matchTag(text, "SellerLevel");
  const ack = matchTag(text, "Ack");

  if (ack && ack !== "Success" && ack !== "Warning") {
    const shortMessage = matchTag(text, "ShortMessage") ?? "Unknown error";
    throw new Error(`eBay Trading API GetUser returned ${ack}: ${shortMessage}`);
  }

  return {
    userId,
    email,
    registrationDate,
    sellerInfo: sellerLevel ? { sellerLevel } : null,
    raw: text.slice(0, 2000),
  };
}

function matchTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1] ?? null;
}
