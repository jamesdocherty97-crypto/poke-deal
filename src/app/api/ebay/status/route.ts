import { NextResponse } from "next/server";
import { getEbayConfig, isEbayConfigured, hasEbayRefreshToken } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { fetchEbayPolicies, fetchEbaySellingPrivileges } from "@/lib/ebay/policies";
import { fetchEbayTradingApiUser } from "@/lib/ebay/accountIdentity";
import { missingEbayLocationSetupFields, readEbayLocationSetup } from "@/lib/ebay/location";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const locationSetup = locationSetupStatus();

  if (!isEbayConfigured()) {
    return NextResponse.json({ configured: false, connected: false, locationSetup });
  }

  const config = getEbayConfig()!;

  if (!hasEbayRefreshToken()) {
    return NextResponse.json({
      configured: true,
      connected: false,
      env: config.env,
      marketplaceId: config.marketplaceId,
      locationSetup,
    });
  }

  try {
    const accessToken = await getAccessToken(config);
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
      hasPolicies: Boolean(policies.paymentPolicyId && policies.fulfillmentPolicyId && policies.returnPolicyId),
      hasMerchantLocation: Boolean(policies.merchantLocationKey),
      policies,
      locationSetup,
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
    return NextResponse.json({
      configured: true,
      connected: false,
      env: config.env,
      marketplaceId: config.marketplaceId,
      locationSetup,
      error: err instanceof Error ? err.message : "eBay connection check failed",
    });
  }
}

function locationSetupStatus() {
  const setup = readEbayLocationSetup();
  const missingFields = missingEbayLocationSetupFields();
  return {
    configured: Boolean(setup),
    missingFields,
    merchantLocationKey: setup?.merchantLocationKey ?? null,
  };
}
