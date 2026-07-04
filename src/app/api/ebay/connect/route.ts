import { NextResponse } from "next/server";
import { getEbayConfig } from "@/lib/ebay/config";
import { buildAuthUrl } from "@/lib/ebay/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = getEbayConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: "eBay is not configured.",
        hint: "Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME.",
      },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  const forceLogin = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
  return NextResponse.redirect(buildAuthUrl(config, forceLogin ? "ebay-force-reconnect" : "ebay-connect", { forceLogin }));
}
