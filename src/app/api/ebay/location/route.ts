import { NextResponse } from "next/server";
import { getEbayConfig, hasEbayRefreshToken, isEbayConfigured } from "@/lib/ebay/config";
import { createInventoryLocation, missingEbayLocationSetupFields, readEbayLocationSetup } from "@/lib/ebay/location";
import { fetchEbayPolicies } from "@/lib/ebay/policies";
import { getAccessToken } from "@/lib/ebay/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isEbayConfigured()) {
    return NextResponse.json({ error: "eBay is not configured." }, { status: 503 });
  }
  if (!hasEbayRefreshToken()) {
    return NextResponse.json({ error: "eBay account is not connected." }, { status: 409 });
  }

  const missingFields = missingEbayLocationSetupFields();
  const setup = readEbayLocationSetup();
  if (!setup) {
    return NextResponse.json(
      {
        error: `Seller location env vars are missing: ${missingFields.join(", ")}.`,
        missingFields,
      },
      { status: 400 },
    );
  }

  const config = getEbayConfig()!;

  try {
    const accessToken = await getAccessToken(config);
    const created = await createInventoryLocation(config, accessToken, setup);
    const policies = await fetchEbayPolicies(config, accessToken);
    return NextResponse.json({
      success: true,
      merchantLocationKey: created.merchantLocationKey,
      hasMerchantLocation: Boolean(policies.merchantLocationKey),
      policies,
      message: "eBay seller location is ready.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "eBay seller location setup failed" },
      { status: 500 },
    );
  }
}
