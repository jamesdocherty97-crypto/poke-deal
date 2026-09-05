import { NextResponse } from "next/server";
import {
  APP_ACCESS_COOKIE,
  APP_ACCESS_COOKIE_ATTRIBUTES,
  APP_ACCESS_SESSION_TTL_SECONDS,
  createAccessSession,
  isValidAccessToken,
  readTrustedDeviceAccessConfig,
} from "../../lib/auth/accessSession";
import { readBoundedJson } from "../../lib/http/boundedJson";
import { accessPage } from "../../lib/auth/accessPage";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_024;

function securityHeaders(nonce?: string): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": nonce
      ? `default-src 'none'; img-src data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
      : "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

export function GET() {
  if (!readTrustedDeviceAccessConfig()) {
    return new NextResponse("Poke Deal trusted-device access is not configured.", {
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
  const config = readTrustedDeviceAccessConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false },
      { status: 503, headers: securityHeaders() },
    );
  }

  if (!isSameOrigin(request)) {
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

  const body = await readBoundedJson<unknown>(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      { ok: false },
      { status: body.status, headers: securityHeaders() },
    );
  }
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return NextResponse.json(
      { ok: false },
      { status: 400, headers: securityHeaders() },
    );
  }
  const token = (body.value as Record<string, unknown>).token;
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
    ...APP_ACCESS_COOKIE_ATTRIBUTES,
    maxAge: APP_ACCESS_SESSION_TTL_SECONDS,
  });
  return response;
}

export function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false },
      { status: 403, headers: securityHeaders() },
    );
  }
  const response = NextResponse.json({ ok: true }, {
    headers: {
      ...securityHeaders(),
      "Clear-Site-Data": '"cache", "cookies", "storage"',
    },
  });
  response.cookies.set({
    name: APP_ACCESS_COOKIE,
    value: "",
    ...APP_ACCESS_COOKIE_ATTRIBUTES,
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}

function isSameOrigin(request: Request): boolean {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return false;

  const requestUrl = new URL(request.url);
  if (suppliedOrigin === requestUrl.origin) return true;

  // Next can canonicalise localhost in request.url during local development,
  // while the browser and Host header use 127.0.0.1. Production proxies also
  // commonly expose the original host/protocol through forwarded headers.
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const forwardedProtocol = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const host = forwardedHost ?? request.headers.get("host");
  const protocol = forwardedProtocol ?? requestUrl.protocol.slice(0, -1);
  if (!host || (protocol !== "http" && protocol !== "https")) return false;

  try {
    return suppliedOrigin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

function firstForwardedValue(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}
