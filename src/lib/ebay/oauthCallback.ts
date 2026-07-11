import { getEbayConfig } from "./config.js";
import { persistEbayRefreshToken, type EbayCredentialDb } from "./credentials.js";
import { exchangeCodeForTokens, type EbayTokenResponse } from "./oauth.js";
import { clearEbayOauthStateCookie, verifyEbayOauthState } from "./oauthState.js";

export type EbayOauthCallbackDeps = {
  exchangeCodeForTokens?: typeof exchangeCodeForTokens;
  persistEbayRefreshToken?: typeof persistEbayRefreshToken;
  db?: EbayCredentialDb;
};

export async function handleEbayOauthCallback(
  request: Request,
  deps: EbayOauthCallbackDeps = {},
): Promise<Response> {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  const config = getEbayConfig();
  if (!config) {
    return Response.json({ error: "eBay not configured." }, { status: 503 });
  }
  const state = verifyEbayOauthState(request, config.clientSecret);
  if (!state.ok) {
    return finishOauthResponse(Response.json({ error: state.error }, { status: 400 }), request);
  }

  if (error) {
    return finishOauthResponse(Response.json(
      {
        error: `eBay OAuth error: ${error}`,
        description: url.searchParams.get("error_description"),
      },
      { status: 400 },
    ), request);
  }

  if (!code) {
    return finishOauthResponse(Response.json(
      { error: "No authorization code in callback." },
      { status: 400 },
    ), request);
  }

  try {
    const exchange = deps.exchangeCodeForTokens ?? exchangeCodeForTokens;
    const persist = deps.persistEbayRefreshToken ?? persistEbayRefreshToken;
    const tokens = await exchange(config, code);
    await persistReturnedRefreshToken(config, tokens, persist, deps.db);

    return finishOauthResponse(new Response(successHtml(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }), request);
  } catch (err) {
    return finishOauthResponse(Response.json(
      { error: err instanceof Error ? err.message : "Token exchange failed" },
      { status: 500 },
    ), request);
  }
}

function finishOauthResponse(response: Response, request: Request): Response {
  response.headers.append("Set-Cookie", clearEbayOauthStateCookie(new URL(request.url).protocol === "https:"));
  return response;
}

async function persistReturnedRefreshToken(
  config: NonNullable<ReturnType<typeof getEbayConfig>>,
  tokens: EbayTokenResponse,
  persist: typeof persistEbayRefreshToken,
  db?: EbayCredentialDb,
): Promise<void> {
  if (!tokens.refresh_token) throw new Error("eBay did not return a refresh token. Reconnect with /api/ebay/connect?force=1.");
  await persist(config, tokens.refresh_token, {
    db,
    refreshTokenExpiresInSeconds: tokens.refresh_token_expires_in,
  });
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>eBay Connected - Poke Deal</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 3rem 1rem; color: #102033; background: #f8fafc; }
    .box { background: white; border: 1px solid #dbe3ef; border-radius: 10px; padding: 1.2rem; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 0.6rem; font-size: 1.5rem; }
    p { margin: 0; color: #475569; line-height: 1.45; }
  </style>
</head>
<body>
  <div class="box">
    <h1>eBay connected ✓</h1>
    <p>You can close this tab and return to Poke Deal.</p>
  </div>
</body>
</html>`;
}
