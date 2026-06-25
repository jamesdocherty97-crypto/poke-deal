import { NextResponse } from "next/server";
import { getEbayConfig, isEbayConfigured, hasEbayRefreshToken } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { fetchEbayPolicies } from "@/lib/ebay/policies";
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
    return NextResponse.json({
      configured: true,
      connected: true,
      env: config.env,
      marketplaceId: config.marketplaceId,
      hasPolicies: Boolean(policies.paymentPolicyId && policies.fulfillmentPolicyId && policies.returnPolicyId),
      hasMerchantLocation: Boolean(policies.merchantLocationKey),
      policies,
      locationSetup,
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
