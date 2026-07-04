import { NextResponse } from "next/server";
import { getEbayConfig } from "@/lib/ebay/config";
import { resolveEbayRefreshToken } from "@/lib/ebay/credentials";
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
  const confirmed = url.searchParams.get("confirm") === "1";
  if (!forceLogin && !confirmed) {
    const existingToken = await resolveEbayRefreshToken().catch(() => null);
    if (existingToken) {
      return new Response(connectChoiceHtml(existingToken.source), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }
  return NextResponse.redirect(buildAuthUrl(config, forceLogin ? "ebay-force-reconnect" : "ebay-connect", { forceLogin }));
}

function connectChoiceHtml(source: "db" | "env"): string {
  const sourceLabel = source === "db" ? "stored in Poke Deal" : "using the legacy environment token";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Reconnect eBay - Poke Deal</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 3rem 1rem; color: #102033; background: #f8fafc; }
    .box { background: white; border: 1px solid #dbe3ef; border-radius: 10px; padding: 1.2rem; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 0.6rem; font-size: 1.5rem; }
    p { color: #475569; line-height: 1.45; }
    .actions { display: grid; gap: 0.7rem; margin-top: 1rem; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; border-radius: 8px; text-decoration: none; font-weight: 700; }
    .primary { background: #0f172a; color: white; }
    .secondary { color: #0f172a; border: 1px solid #cbd5e1; }
  </style>
</head>
<body>
  <div class="box">
    <h1>eBay is already connected</h1>
    <p>Your seller account token is ${sourceLabel}. Use force reconnect if eBay asks for fresh permissions, the token has expired, or you connected the wrong seller account.</p>
    <div class="actions">
      <a class="primary" href="/api/ebay/connect?force=1">Force reconnect</a>
      <a class="secondary" href="/api/ebay/connect?confirm=1">Continue normal consent</a>
    </div>
  </div>
</body>
</html>`;
}
