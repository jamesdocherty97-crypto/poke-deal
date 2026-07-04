import { handleEbayOauthCallback } from "@/lib/ebay/oauthCallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleEbayOauthCallback(request);
}
