// Lightweight password gate for when the app is deployed publicly (e.g. Vercel).
// Disabled locally: if APP_PASSWORD is unset, every request passes through, so
// local dev and tests are unaffected. Set APP_PASSWORD in your Vercel env to turn it on.
//
// Uses HTTP Basic auth — the browser shows a native login prompt and remembers it,
// which works fine inside an iOS "Add to Home Screen" PWA. Single operator, so any
// username is accepted and only the password is checked.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "./lib/automation/cronAuth";

export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next(); // gate disabled

  const header = req.headers.get("authorization");
  if (req.nextUrl.pathname.startsWith("/api/cron/") && isAuthorizedCronRequest(header)) {
    return NextResponse.next();
  }

  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6)); // "user:pass"
      const provided = decoded.slice(decoded.indexOf(":") + 1);
      if (provided === password) return NextResponse.next();
    } catch {
      // fall through to 401
    }
  }

  return new NextResponse(passwordGateHtml(), {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "WWW-Authenticate": 'Basic realm="Poke Deal", charset="UTF-8"',
    },
  });
}

function passwordGateHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Poke Deal</title>
  <style>
    :root { color-scheme: dark; --bg: #080b13; --ink: #f8fbff; --muted: #aeb9cf; --yellow: #ffcb05; --red: #ef3340; --blue: #2a75bb; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; overflow: hidden; background: radial-gradient(circle at 72% 18%, rgba(255,203,5,.2), transparent 24%), linear-gradient(140deg, rgba(239,51,64,.22), rgba(42,117,187,.18) 48%, var(--bg)); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { position: relative; display: grid; justify-items: center; gap: 18px; width: min(420px, calc(100vw - 32px)); padding: 28px 22px; text-align: center; }
    .ball { position: relative; width: 116px; height: 116px; border: 5px solid #101827; border-radius: 999px; background: linear-gradient(#f8fbff 0 48%, #101827 48% 52%, var(--red) 52% 100%); box-shadow: inset 0 0 0 5px rgba(255,255,255,.78), 0 18px 48px rgba(0,0,0,.4), 0 0 44px rgba(255,203,5,.16); }
    .ball::before { position: absolute; inset: 50% auto auto 50%; width: 34px; height: 34px; content: ""; border: 5px solid #101827; border-radius: inherit; background: #f8fbff; transform: translate(-50%, -50%); }
    h1 { margin: 0; font-size: 42px; line-height: .95; }
    p { max-width: 30ch; margin: 0; color: var(--muted); font-size: 15px; line-height: 1.45; }
    a { display: inline-grid; min-height: 44px; place-items: center; margin-top: 4px; border: 1px solid rgba(255,203,5,.38); border-radius: 10px; background: rgba(255,203,5,.14); color: #fff4b0; padding: 0 16px; font-weight: 900; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <span class="ball" aria-hidden="true"></span>
    <h1>Poke Deal</h1>
    <p>Enter the app password in the browser prompt to unlock your dealer workspace.</p>
    <a href="/">Try again</a>
  </main>
</body>
</html>`;
}

// Protect everything except Next internals and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
