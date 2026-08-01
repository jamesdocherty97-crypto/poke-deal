// Password-free trusted-device gate for public deployments.
//
// The owner authorises a browser once through /access#<high-entropy-token>.
// That exchange creates a signed, Secure, HttpOnly cookie which is renewed
// during normal use, so opening the installed app does not show a login prompt.
// Production fails closed when the two independent access secrets are missing.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "./lib/automation/cronAuth";
import { isEbayAccountDeletionCallbackPath, isEbayOauthCallbackPath } from "./lib/ebay/callbackPath";
import { allowsPublicAppAccess, requiresTrustedDeviceAccess } from "./lib/auth/appAccess";
import { accessPage, accessPageSecurityHeaders } from "./lib/auth/accessPage";
import {
  APP_ACCESS_COOKIE,
  APP_ACCESS_COOKIE_ATTRIBUTES,
  APP_ACCESS_SESSION_TTL_SECONDS,
  createAccessSession,
  inspectAccessSession,
  readTrustedDeviceAccessConfig,
} from "./lib/auth/accessSession";

export async function middleware(req: NextRequest) {
  // Crawlers must be able to read the exact disallow-all policy. No other
  // document or API path becomes public through this exemption.
  if (req.nextUrl.pathname === "/robots.txt") {
    return NextResponse.next();
  }

  // The install manifest and its referenced artwork contain no private data.
  // Keeping only these static paths public lets browsers install the PWA
  // without depending on manifest-fetch credential behaviour.
  if (isPublicPwaAssetPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // eBay must reach this provider callback without an operator session. The
  // route performs its own challenge and signature validation.
  if (isEbayAccountDeletionCallbackPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // eBay's cross-site browser return cannot carry the Strict app session.
  // These exact routes instead require the short-lived signed, browser-bound
  // OAuth state cookie before any token exchange can occur.
  if (isEbayOauthCallbackPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const authorization = req.headers.get("authorization");
  if (req.nextUrl.pathname.startsWith("/api/cron/")) {
    if (isAuthorizedCronRequest(authorization)) return NextResponse.next();
    return NextResponse.json(
      { error: "Unauthorized cron request." },
      { status: 401, headers: lockedResponseHeaders() },
    );
  }

  // Explicit local audit mode. Real production must never set this flag.
  if (allowsPublicAppAccess(process.env, req.nextUrl.hostname)) return NextResponse.next();

  const accessConfig = readTrustedDeviceAccessConfig();
  if (!accessConfig) {
    if (!requiresTrustedDeviceAccess(process.env, req.nextUrl.hostname)) return NextResponse.next();
    return new NextResponse("Poke Deal trusted-device access is not configured.", {
      status: 503,
      headers: {
        ...lockedResponseHeaders(),
        "Content-Type": "text/plain; charset=UTF-8",
      },
    });
  }

  // Serve the enrollment document directly from middleware so its nonce-based
  // CSP cannot be replaced by Next's global static headers. Non-GET methods
  // continue to the route's same-origin, body, and token checks.
  if (req.nextUrl.pathname === "/access") {
    if (req.method === "GET" || req.method === "HEAD") {
      const nonce = crypto.randomUUID();
      return new NextResponse(req.method === "HEAD" ? null : accessPage(nonce), {
        status: 200,
        headers: {
          ...accessPageSecurityHeaders(nonce),
          "Content-Type": "text/html; charset=UTF-8",
        },
      });
    }
    return NextResponse.next();
  }

  const session = await inspectAccessSession(
    req.cookies.get(APP_ACCESS_COOKIE)?.value,
    accessConfig.sessionSecret,
  );
  if (session.valid) {
    const response = NextResponse.next();
    if (session.shouldRenew) {
      response.cookies.set({
        name: APP_ACCESS_COOKIE,
        value: await createAccessSession(accessConfig.sessionSecret),
        ...APP_ACCESS_COOKIE_ATTRIBUTES,
        maxAge: APP_ACCESS_SESSION_TTL_SECONDS,
      });
    }
    return response;
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "This browser is not authorised for Poke Deal." },
      { status: 401, headers: lockedResponseHeaders() },
    );
  }

  const nonce = crypto.randomUUID();
  return new NextResponse(untrustedDevicePage(nonce), {
    status: 403,
    headers: {
      ...lockedResponseHeaders(nonce),
      "Content-Type": "text/html; charset=UTF-8",
    },
  });
}

function lockedResponseHeaders(nonce?: string): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": nonce
      ? `default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
      : "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function isPublicPwaAssetPath(pathname: string): boolean {
  return PUBLIC_PWA_ASSET_PATHS.has(pathname);
}

const PUBLIC_PWA_ASSET_PATHS = new Set([
  "/manifest.webmanifest",
  "/splash.svg",
  "/brand/v2/app-icon-192-v1.png",
  "/brand/v2/app-icon-512-v1.png",
  "/brand/v2/app-icon-maskable-512-v1.png",
  "/brand/v2/apple-touch-icon-180-v1.png",
  "/brand/v2/favicon-32-v1.png",
  "/brand/v2/favicon-v1.ico",
]);

function untrustedDevicePage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <link rel="icon" href="data:," />
  <title>Private device · Poke Deal</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; --bg: #080b13; --ink: #f8fbff; --muted: #aeb9cf; --yellow: #ffcb05; --red: #ef3340; --blue: #2a75bb; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; min-height: 100svh; margin: 0; display: grid; place-items: center; background: radial-gradient(circle at 72% 18%, rgba(255,203,5,.2), transparent 24%), linear-gradient(140deg, rgba(239,51,64,.22), rgba(42,117,187,.18) 48%, var(--bg)); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: grid; justify-items: center; gap: 16px; width: min(420px, calc(100vw - 32px)); padding: max(28px, env(safe-area-inset-top)) 22px max(28px, env(safe-area-inset-bottom)); text-align: center; }
    .ball { position: relative; width: 96px; height: 96px; border: 5px solid #101827; border-radius: 999px; background: linear-gradient(#f8fbff 0 48%, #101827 48% 52%, var(--red) 52% 100%); box-shadow: inset 0 0 0 5px rgba(255,255,255,.78), 0 18px 48px rgba(0,0,0,.4); }
    .ball::before { position: absolute; inset: 50% auto auto 50%; width: 28px; height: 28px; content: ""; border: 5px solid #101827; border-radius: inherit; background: #f8fbff; transform: translate(-50%, -50%); }
    h1 { margin: 0; font-size: clamp(32px, 10vw, 42px); line-height: 1; }
    p { max-width: 34ch; margin: 0; color: var(--muted); font-size: 15px; line-height: 1.5; }
    strong { color: #fff4b0; }
  </style>
</head>
<body>
  <main>
    <span class="ball" aria-hidden="true"></span>
    <h1>Private device</h1>
    <p>This browser has not been trusted for Poke Deal yet.</p>
    <p><strong>Open your private unlock link once.</strong> After that, the app opens normally with no password.</p>
  </main>
</body>
</html>`;
}

// Protect everything except Next internals and static image/font assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
