import { NextResponse } from "next/server";
import { getEbayConfig, isEbayConfigured } from "@/lib/ebay/config";
import {
  createInventoryLocation,
  missingEbayLocationSetupFields,
  readEbayLocationSetup,
  readEbayLocationSetupInput,
} from "@/lib/ebay/location";
import { fetchEbayPolicies } from "@/lib/ebay/policies";
import { resolveEbayRefreshToken } from "@/lib/ebay/credentials";
import { getAccessTokenWithSource } from "@/lib/ebay/tokens";
import { ebayApiErrorLogBody, ebayApiErrorResponseBody, isEbayApiError } from "@/lib/ebay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isEbayConfigured()) {
    return NextResponse.json({ error: "eBay is not configured." }, { status: 503 });
  }
  const refreshToken = await resolveEbayRefreshToken().catch(() => null);
  if (!refreshToken) {
    return NextResponse.json({ error: "eBay account is not connected." }, { status: 409 });
  }

  const requestText = await request.text();
  const requestBody = parseJsonBody(requestText);
  const parsed = requestBody ? readEbayLocationSetupInput(requestBody) : null;
  const missingFields = parsed?.missingFields.length ? parsed.missingFields : missingEbayLocationSetupFields();
  const setup = parsed?.setup ?? readEbayLocationSetup();
  if (!setup) {
    return NextResponse.json(
      {
        error: requestBody
          ? `Seller location details are missing: ${missingFields.join(", ")}.`
          : `Seller location env vars are missing: ${missingFields.join(", ")}.`,
        missingFields,
      },
      { status: 400 },
    );
  }

  const config = getEbayConfig()!;

  try {
    const { accessToken } = await getAccessTokenWithSource(config, fetch, { refreshToken });
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
    if (isEbayApiError(err)) {
      console.error("[ebay] seller location setup failed", ebayApiErrorLogBody(err));
    }
    return NextResponse.json(
      ebayApiErrorResponseBody(err, "eBay seller location setup failed"),
      { status: 500 },
    );
  }
}

function parseJsonBody(value: string): Record<string, unknown> | null {
  if (!value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
