import { NextResponse } from "next/server";
import { getEbayConfig } from "@/lib/ebay/config";
import { exchangeCodeForTokens } from "@/lib/ebay/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (error) {
    return NextResponse.json(
      {
        error: `eBay OAuth error: ${error}`,
        description: url.searchParams.get("error_description"),
      },
      { status: 400 },
    );
  }

  if (!code) {
    return NextResponse.json(
      { error: "No authorization code in callback." },
      { status: 400 },
    );
  }

  const config = getEbayConfig();
  if (!config) {
    return NextResponse.json({ error: "eBay not configured." }, { status: 503 });
  }

  try {
    const tokens = await exchangeCodeForTokens(config, code);
    const refreshDays = tokens.refresh_token_expires_in
      ? Math.round(tokens.refresh_token_expires_in / 86400)
      : null;

    // Show the refresh token to the user once so they can save it.
    // The access token is short-lived and not shown.
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>eBay Connected - Poke Deal</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 1rem; }
    h1 { color: #1a1a1a; }
    .box { background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 1rem 1.2rem; margin: 1rem 0; }
    .warn { background: #fff8e1; border-color: #f9a825; }
    code { font-family: monospace; word-break: break-all; font-size: 0.9em; }
    ol li { margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>eBay Connected</h1>
  <p>Authorization complete. Save the refresh token below, then the app can list on eBay.</p>
  <div class="box warn">
    <strong>Save this refresh token now</strong> — it will not be shown again.
    ${refreshDays ? `<br>Expires in approximately ${refreshDays} days.` : ""}
  </div>
  <div class="box">
    <p><strong>EBAY_REFRESH_TOKEN</strong></p>
    <code>${tokens.refresh_token ?? "(no refresh token returned — check OAuth scopes)"}</code>
  </div>
  <h2>Next steps</h2>
  <ol>
    <li>Copy the token above.</li>
    <li>In Vercel: Project → Settings → Environment Variables → add <code>EBAY_REFRESH_TOKEN</code>.</li>
    <li>Also paste it into your local <code>.env</code> file.</li>
    <li>Redeploy (or restart dev server) — the app will show eBay as connected.</li>
  </ol>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Token exchange failed" },
      { status: 500 },
    );
  }
}
