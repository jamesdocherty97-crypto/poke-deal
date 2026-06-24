import { NextResponse } from "next/server";
import { getEbayConfig } from "@/lib/ebay/config";
import { buildAuthUrl } from "@/lib/ebay/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
  return NextResponse.redirect(buildAuthUrl(config));
}
