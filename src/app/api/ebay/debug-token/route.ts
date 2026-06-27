import { NextResponse } from "next/server";
import { getEbayConfig, isEbayConfigured, hasEbayRefreshToken } from "@/lib/ebay/config";
import { refreshAccessToken } from "@/lib/ebay/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY diagnostic route — never returns the actual token or refresh
// token values, only sanitized shape/metadata, so it's safe to leave
// deployed briefly while root-causing the "Invalid access token" regression.
// Remove once resolved.
export async function GET() {
  if (!isEbayConfigured()) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  if (!hasEbayRefreshToken()) {
    return NextResponse.json({ error: "no refresh token" }, { status: 409 });
  }
  const config = getEbayConfig()!;
  const refreshToken = process.env.EBAY_REFRESH_TOKEN!.trim();

  try {
    const tokens = await refreshAccessToken(config, refreshToken);
    const directCheck = await fetch(
      `${config.apiBaseUrl}/sell/account/v1/payment_policy?marketplace_id=${config.marketplaceId}`,
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "X-EBAY-C-MARKETPLACE-ID": config.marketplaceId,
        },
      },
    );
    const directCheckBody = await directCheck.text();

    return NextResponse.json({
      refresh: {
        tokenType: tokens.token_type,
        expiresIn: tokens.expires_in,
        accessTokenLength: tokens.access_token?.length ?? 0,
        accessTokenPrefix: tokens.access_token?.slice(0, 12) ?? null,
        gotNewRefreshToken: Boolean(tokens.refresh_token),
        refreshTokenExpiresIn: tokens.refresh_token_expires_in,
      },
      refreshTokenEnv: {
        length: refreshToken.length,
        prefix: refreshToken.slice(0, 12),
        suffix: refreshToken.slice(-6),
      },
      config: {
        env: config.env,
        apiBaseUrl: config.apiBaseUrl,
        marketplaceId: config.marketplaceId,
        clientIdPrefix: config.clientId.slice(0, 10),
      },
      directCheck: {
        status: directCheck.status,
        ok: directCheck.ok,
        body: directCheckBody.slice(0, 1000),
      },
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "unknown error",
    }, { status: 500 });
  }
}
