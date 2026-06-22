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

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Pokémon Dealer OS", charset="UTF-8"' },
  });
}

// Protect everything except Next internals and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
