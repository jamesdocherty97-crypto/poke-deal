import { NextResponse } from "next/server";
import { getEbayConfig, isEbayConfigured } from "@/lib/ebay/config";
import { resolveEbayRefreshToken } from "@/lib/ebay/credentials";
import { getAccessTokenWithSource } from "@/lib/ebay/tokens";
import { ebayErrorMessage, ebayReconnectHintForError } from "@/lib/ebay/errors";
import { fetchEbayPolicies, fetchEbaySellingPrivileges } from "@/lib/ebay/policies";
import { fetchEbayTradingApiUser } from "@/lib/ebay/accountIdentity";
import {
  missingEbayLocationSetupFields,
  missingRecommendedEbayLocationSetupFields,
  readEbayLocationSetup,
} from "@/lib/ebay/location";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const locationSetup = locationSetupStatus();

  if (!isEbayConfigured()) {
    return NextResponse.json({ configured: false, connected: false, locationSetup });
  }

  const config = getEbayConfig()!;

  let refreshToken;
  try {
    refreshToken = await resolveEbayRefreshToken();
  } catch (err) {
    return NextResponse.json({
      configured: true,
      connected: false,
      env: config.env,
      marketplaceId: config.marketplaceId,
      tokenSource: "db",
      locationSetup,
      error: err instanceof Error ? err.message : "eBay stored token could not be read.",
      reconnectUrl: "/api/ebay/connect?force=1",
    });
  }

  if (!refreshToken) {
    return NextResponse.json({
      configured: true,
      connected: false,
      env: config.env,
      marketplaceId: config.marketplaceId,
      tokenSource: null,
      locationSetup,
    });
  }

  try {
    const { accessToken, tokenSource } = await getAccessTokenWithSource(config, fetch, { refreshToken });
    const policies = await fetchEbayPolicies(config, accessToken);

    // Diagnostics: which eBay account is actually behind the connected OAuth
    // token, and has that account finished eBay's own seller registration
    // (identity verification + payout method)? Neither of these failing
    // blocks offer/inventory creation — only publish enforces them — so they
    // surface here as informational fields rather than throwing.
    const [privileges, identity] = await Promise.all([
      fetchEbaySellingPrivileges(config, accessToken).catch((err) => ({
        sellerRegistrationCompleted: null,
        sellingLimit: null,
        error: err instanceof Error ? err.message : "privilege check failed",
      })),
      fetchEbayTradingApiUser(config, accessToken).catch((err) => ({
        userId: null,
        email: null,
        registrationDate: null,
        sellerInfo: null,
        error: err instanceof Error ? err.message : "GetUser failed",
      })),
    ]);

    return NextResponse.json({
      configured: true,
      connected: true,
      env: config.env,
      marketplaceId: config.marketplaceId,
      tokenSource,
      hasPolicies: Boolean(policies.paymentPolicyId && policies.fulfillmentPolicyId && policies.returnPolicyId),
      hasMerchantLocation: Boolean(policies.merchantLocationKey),
      policies,
      locationSetup: {
        ...locationSetup,
        existsOnEbay: policies.configuredMerchantLocationKey ? policies.configuredMerchantLocationFound === true : Boolean(policies.merchantLocationKey),
      },
      connectedAccount: {
        verified: Boolean(identity.userId),
        registrationDate: identity.registrationDate,
        sellerLevel: identity.sellerInfo?.sellerLevel ?? null,
        identityCheckError: "error" in identity ? identity.error : undefined,
      },
      sellerRegistration: {
        completed: privileges.sellerRegistrationCompleted,
        sellingLimit: privileges.sellingLimit,
        checkError: "error" in privileges ? privileges.error : undefined,
      },
    });
  } catch (err) {
    const hint = ebayReconnectHintForError(err);
    const error = ebayErrorMessage(err, "eBay connection check failed");
    return NextResponse.json({
      configured: true,
      connected: false,
      env: config.env,
      marketplaceId: config.marketplaceId,
      tokenSource: refreshToken.source,
      locationSetup,
      error,
      reconnectUrl: hint || needsReconnect(error) ? "/api/ebay/connect?force=1" : undefined,
    });
  }
}

function locationSetupStatus() {
  const setup = readEbayLocationSetup();
  const missingFields = missingEbayLocationSetupFields();
  const missingRecommendedFields = missingRecommendedEbayLocationSetupFields();
  return {
    configured: Boolean(setup),
    createAvailable: Boolean(setup),
    missingFields,
    missingRecommendedFields,
    merchantLocationKey: setup?.merchantLocationKey ?? null,
    merchantLocationKeyFromEnv: missingRecommendedFields.length === 0,
  };
}

function needsReconnect(error: string): boolean {
  return /(?:invalid[_ ]grant|invalid access token|authorization|refresh token|token refresh|token exchange|expired|revoked)/i.test(error);
}
