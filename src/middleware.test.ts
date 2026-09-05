import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { config, middleware } from "./middleware.js";
import {
  APP_ACCESS_COOKIE,
  APP_ACCESS_SESSION_RENEWAL_WINDOW_SECONDS,
  APP_ACCESS_SESSION_TTL_SECONDS,
  createAccessSession,
} from "./lib/auth/accessSession.js";

const accessToken = "a".repeat(43);
const sessionSecret = "b".repeat(43);
const managedKeys = [
  "APP_ACCESS_TOKEN",
  "APP_SESSION_SECRET",
  "APP_PUBLIC_ACCESS",
  "CRON_SECRET",
  "NODE_ENV",
  "VERCEL_ENV",
] as const;

test("production fails closed when trusted-device access is not configured", { concurrency: false }, async () => {
  await withEnv({ VERCEL_ENV: "production", NODE_ENV: "production" }, async () => {
    const response = await middleware(request("/"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  });
});

test("Vercel production ignores the public-access test flag", { concurrency: false }, async () => {
  await withEnv({ VERCEL_ENV: "production", NODE_ENV: "production", APP_PUBLIC_ACCESS: "true" }, async () => {
    assert.equal((await middleware(request("/"))).status, 503);
  });
});

test("Vercel previews fail closed when access is not configured", { concurrency: false }, async () => {
  await withEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" }, async () => {
    assert.equal((await middleware(request("/api/inventory"))).status, 503);
  });
});

test("the public audit escape hatch works only on loopback", { concurrency: false }, async () => {
  await withEnv({ NODE_ENV: "production", APP_PUBLIC_ACCESS: "true" }, async () => {
    assert.equal((await middleware(request("/"))).status, 503);
    const local = new NextRequest("http://127.0.0.1/", {});
    assert.equal((await middleware(local)).headers.get("x-middleware-next"), "1");
  });
});

test("development remains open when trusted-device access is not configured", { concurrency: false }, async () => {
  await withEnv({ NODE_ENV: "development" }, async () => {
    assert.equal((await middleware(request("/"))).headers.get("x-middleware-next"), "1");
  });
});

test("untrusted pages and APIs are denied without a Basic challenge", { concurrency: false }, async () => {
  await withAccessEnv(async () => {
    const page = await middleware(request("/", { authorization: basic("anything:legacy-password") }));
    assert.equal(page.status, 403);
    assert.equal(page.headers.get("www-authenticate"), null);
    assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    const html = await page.text();
    assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive"/);
    assert.match(html, /Open your private unlock link once/i);
    assert.match(html, /<a class="unlock-link" href="\/access">Unlock this browser<\/a>/);

    const api = await middleware(request("/api/comps"));
    assert.equal(api.status, 401);
    assert.equal(api.headers.get("www-authenticate"), null);
    assert.deepEqual(await api.json(), { error: "This browser is not authorised for Poke Deal." });
  });
});

test("a valid trusted-device cookie passes and renews only near expiry", { concurrency: false }, async () => {
  await withAccessEnv(async () => {
    const fresh = await createAccessSession(sessionSecret);
    const freshResponse = await middleware(request("/", { cookie: `${APP_ACCESS_COOKIE}=${fresh}` }));
    assert.equal(freshResponse.headers.get("x-middleware-next"), "1");
    assert.equal(freshResponse.headers.get("set-cookie"), null);

    const issuedAt = Date.now()
      - (APP_ACCESS_SESSION_TTL_SECONDS - APP_ACCESS_SESSION_RENEWAL_WINDOW_SECONDS + 60) * 1000;
    const ageing = await createAccessSession(sessionSecret, issuedAt);
    const renewed = await middleware(request("/", { cookie: `${APP_ACCESS_COOKIE}=${ageing}` }));
    assert.equal(renewed.headers.get("x-middleware-next"), "1");
    assert.match(renewed.headers.get("set-cookie") ?? "", new RegExp(`${APP_ACCESS_COOKIE}=`));
    assert.match(renewed.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(renewed.headers.get("set-cookie") ?? "", /Secure/i);
    assert.match(renewed.headers.get("set-cookie") ?? "", /SameSite=Strict/i);
  });
});

test("public and self-authenticated route exceptions are exact", { concurrency: false }, async () => {
  await withAccessEnv(async () => {
    for (const pathname of [
      "/robots.txt",
      "/manifest.webmanifest",
      "/brand/v2/app-icon-192-v1.png",
      "/api/ebay/account-deletion",
      "/api/ebay/oauth",
      "/api/ebay/oauth/callback",
    ]) {
      assert.equal(
        (await middleware(request(pathname))).headers.get("x-middleware-next"),
        "1",
        `${pathname} should pass middleware`,
      );
    }

    const accessPage = await middleware(request("/access"));
    assert.equal(accessPage.status, 200);
    assert.equal(accessPage.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.match(accessPage.headers.get("content-security-policy") ?? "", /script-src 'nonce-/);
    assert.match(await accessPage.text(), /Trusting this browser/i);

    const accessPost = await middleware(new NextRequest("https://poke-deal.test/access", {
      method: "POST",
    }));
    assert.equal(accessPost.headers.get("x-middleware-next"), "1");

    assert.equal((await middleware(request("/access/other"))).status, 403);
    assert.equal((await middleware(request("/favicon.ico"))).status, 403);
    assert.equal((await middleware(request("/favicon.ico.private"))).status, 403);
    assert.equal((await middleware(request("/faviconXico"))).status, 403);
    assert.equal((await middleware(request("/brand/v2/private.json"))).status, 403);
    assert.equal((await middleware(request("/api/ebay/status"))).status, 401);
    assert.equal((await middleware(request("/api/ebay/account-deletion/other"))).status, 401);
    assert.equal((await middleware(request("/api/ebay/oauth/other"))).status, 401);
  });
});

test("the matcher excludes only Next internals, not favicon-like paths", () => {
  assert.deepEqual(config.matcher, ["/((?!_next/static|_next/image).*)"]);
});

test("cron routes require their bearer secret even from a trusted browser", { concurrency: false }, async () => {
  await withAccessEnv(async () => {
    const session = await createAccessSession(sessionSecret);
    const denied = await middleware(request("/api/cron/daily", {
      cookie: `${APP_ACCESS_COOKIE}=${session}`,
    }));
    assert.equal(denied.status, 401);

    const allowed = await middleware(request("/api/cron/daily", {
      authorization: "Bearer cron-secret",
    }));
    assert.equal(allowed.headers.get("x-middleware-next"), "1");
  }, { CRON_SECRET: "cron-secret" });
});

function request(pathname: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://poke-deal.test${pathname}`, { headers });
}

function basic(value: string): string {
  return `Basic ${Buffer.from(value).toString("base64")}`;
}

async function withAccessEnv(
  run: () => Promise<void>,
  extra: Record<string, string> = {},
): Promise<void> {
  await withEnv({
    APP_ACCESS_TOKEN: accessToken,
    APP_SESSION_SECRET: sessionSecret,
    VERCEL_ENV: "production",
    NODE_ENV: "production",
    ...extra,
  }, run);
}

async function withEnv(
  values: Record<string, string>,
  run: () => Promise<void>,
): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  const previous = Object.fromEntries(managedKeys.map((key) => [key, env[key]]));
  for (const key of managedKeys) delete env[key];
  Object.assign(env, values);
  try {
    await run();
  } finally {
    for (const key of managedKeys) {
      const value = previous[key];
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}
