import assert from "node:assert/strict";
import test from "node:test";
import { trustedDeviceCookie, trustedDeviceHeaders } from "./trustedAccess.mjs";

const token = "a".repeat(43);

test("maintenance requests remain ordinary when no enrollment token is supplied", { concurrency: false }, async () => {
  await withToken(undefined, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("fetch should not run");
    };
    try {
      assert.deepEqual(
        await trustedDeviceHeaders("https://poke-deal.test", { accept: "application/json" }),
        { accept: "application/json" },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("maintenance requests exchange the fragment token for a cookie without logging it", { concurrency: false }, async () => {
  await withToken(token, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://poke-deal.test/access");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("origin"), "https://poke-deal.test");
      assert.deepEqual(JSON.parse(String(init?.body)), { token });
      return new Response('{"ok":true}', {
        headers: {
          "Set-Cookie": "__Host-poke-deal-access=v1.session.signature; Path=/; Secure; HttpOnly; SameSite=Strict",
        },
      });
    };
    try {
      assert.deepEqual(await trustedDeviceCookie("https://poke-deal.test/private"), {
        name: "__Host-poke-deal-access",
        value: "v1.session.signature",
      });
      assert.deepEqual(
        await trustedDeviceHeaders("https://poke-deal.test", { accept: "application/json" }),
        {
          accept: "application/json",
          Cookie: "__Host-poke-deal-access=v1.session.signature",
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("failed enrollment reports only the status code", { concurrency: false }, async () => {
  await withToken(token, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("denied", { status: 401 });
    try {
      await assert.rejects(
        trustedDeviceCookie("https://poke-deal.test"),
        (error: Error) => error.message === "Trusted-device enrollment failed with HTTP 401."
          && !error.message.includes(token),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("the master enrollment token is never sent to an unapproved or insecure remote origin", { concurrency: false }, async () => {
  await withToken(token, async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response();
    };
    try {
      await assert.rejects(
        trustedDeviceCookie("https://attacker.test"),
        /unapproved origin/i,
      );
      await assert.rejects(
        trustedDeviceCookie("http://poke-deal.test"),
        /requires HTTPS/i,
      );
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

async function withToken(value: string | undefined, run: () => Promise<void>): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  const keys = [
    "POKE_DEAL_ACCESS_TOKEN",
    "VERIFY_PROD_ACCESS_TOKEN",
    "APP_ACCESS_TOKEN",
    "POKE_DEAL_ACCESS_ORIGIN",
    "NEXT_PUBLIC_APP_URL",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, env[key]]));
  for (const key of keys) delete env[key];
  if (value) {
    env.POKE_DEAL_ACCESS_TOKEN = value;
    env.POKE_DEAL_ACCESS_ORIGIN = "https://poke-deal.test";
  }
  try {
    await run();
  } finally {
    for (const key of keys) {
      const prior = previous[key];
      if (prior === undefined) delete env[key];
      else env[key] = prior;
    }
  }
}
