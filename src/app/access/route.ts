import { NextResponse } from "next/server";
import {
  APP_ACCESS_COOKIE,
  APP_ACCESS_SESSION_TTL_SECONDS,
  createAccessSession,
  isValidAccessToken,
  readPasswordlessAccessConfig,
} from "../../lib/auth/accessSession";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_024;

function securityHeaders(nonce?: string): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": nonce
      ? `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
      : "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

export function GET() {
  if (!readPasswordlessAccessConfig()) {
    return new NextResponse("Poke Deal access links are not configured.", {
      status: 503,
      headers: { ...securityHeaders(), "Content-Type": "text/plain; charset=UTF-8" },
    });
  }

  const nonce = crypto.randomUUID();
  return new NextResponse(accessPage(nonce), {
    status: 200,
    headers: { ...securityHeaders(nonce), "Content-Type": "text/html; charset=UTF-8" },
  });
}

export async function POST(request: Request) {
  const config = readPasswordlessAccessConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false },
      { status: 503, headers: securityHeaders() },
    );
  }

  const requestUrl = new URL(request.url);
  if (request.headers.get("origin") !== requestUrl.origin) {
    return NextResponse.json(
      { ok: false },
      { status: 403, headers: securityHeaders() },
    );
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { ok: false },
      { status: 415, headers: securityHeaders() },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false },
      { status: 413, headers: securityHeaders() },
    );
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false },
      { status: 413, headers: securityHeaders() },
    );
  }

  let token: unknown;
  try {
    token = (JSON.parse(rawBody) as { token?: unknown }).token;
  } catch {
    token = undefined;
  }
  if (!(await isValidAccessToken(token, config.accessToken))) {
    return NextResponse.json(
      { ok: false },
      { status: 401, headers: securityHeaders() },
    );
  }

  const response = NextResponse.json({ ok: true }, { headers: securityHeaders() });
  response.cookies.set({
    name: APP_ACCESS_COOKIE,
    value: await createAccessSession(config.sessionSecret),
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: APP_ACCESS_SESSION_TTL_SECONDS,
  });
  return response;
}

function accessPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <link rel="icon" href="data:," />
  <title>Unlock Poke Deal</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; --bg: #080b13; --ink: #f8fbff; --muted: #aeb9cf; --yellow: #ffcb05; --red: #ef3340; --blue: #2a75bb; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: radial-gradient(circle at 72% 18%, rgba(255,203,5,.2), transparent 24%), linear-gradient(140deg, rgba(239,51,64,.22), rgba(42,117,187,.18) 48%, var(--bg)); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: grid; justify-items: center; gap: 16px; width: min(420px, calc(100vw - 32px)); padding: 28px 22px; text-align: center; }
    .ball { position: relative; width: 96px; height: 96px; border: 5px solid #101827; border-radius: 999px; background: linear-gradient(#f8fbff 0 48%, #101827 48% 52%, var(--red) 52% 100%); box-shadow: inset 0 0 0 5px rgba(255,255,255,.78), 0 18px 48px rgba(0,0,0,.4); }
    .ball::before { position: absolute; inset: 50% auto auto 50%; width: 28px; height: 28px; content: ""; border: 5px solid #101827; border-radius: inherit; background: #f8fbff; transform: translate(-50%, -50%); }
    h1 { margin: 0; font-size: 36px; line-height: 1; }
    p { max-width: 32ch; margin: 0; color: var(--muted); font-size: 15px; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <span class="ball" aria-hidden="true"></span>
    <h1>Unlocking Poke Deal</h1>
    <p id="status" role="status" aria-live="polite">Securing this browser session…</p>
  </main>
  <script nonce="${nonce}">
    (() => {
      const status = document.getElementById("status");
      const token = location.hash.slice(1);
      history.replaceState(null, "", "/access");
      if (!token) {
        status.textContent = "This access link is incomplete.";
        return;
      }
      fetch("/access", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      }).then((response) => {
        if (!response.ok) throw new Error("Access denied");
        location.replace("/");
      }).catch(() => {
        status.textContent = "This access link is invalid or expired.";
      });
    })();
  </script>
</body>
</html>`;
}
