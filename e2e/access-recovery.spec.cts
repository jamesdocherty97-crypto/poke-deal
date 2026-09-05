import { expect, test, type BrowserContext, type Page } from "playwright/test";
import { NextRequest } from "next/server";
import { createServer, type Server } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST } from "../src/app/access/route";
import { APP_ACCESS_COOKIE } from "../src/lib/auth/accessSession";
import { middleware } from "../src/middleware";

// Exercise the real enrollment document, gate, and exchange without loading
// application data, a Next server, provider configuration, or environment files.
let ORIGIN = "";
const TOKEN = "a".repeat(43);
const unlockLink = () => `${ORIGIN}/access#${TOKEN}`;
const envKeys = ["APP_ACCESS_TOKEN", "APP_SESSION_SECRET", "APP_PUBLIC_ACCESS", "VERCEL_ENV"] as const;
let savedEnv: Record<string, string | undefined>;
let server: Server;
let certificateDirectory: string;
let serveEnrollment: (request: Request) => Promise<Response | null>;

test.beforeAll(async () => {
  certificateDirectory = mkdtempSync(join(tmpdir(), "poke-deal-auth-test-"));
  // A disposable certificate keeps Secure cookie transport real in WebKit.
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", join(certificateDirectory, "key.pem"), "-out", join(certificateDirectory, "cert.pem"),
    "-subj", "/CN=localhost"], { stdio: "ignore" });
  server = createServer({
    key: readFileSync(join(certificateDirectory, "key.pem")),
    cert: readFileSync(join(certificateDirectory, "cert.pem")),
  }, async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const request = new Request(`${ORIGIN}${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await serveEnrollment(request);
    if (!response) { outgoing.destroy(); return; }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No synthetic HTTPS port");
  ORIGIN = `https://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(certificateDirectory, { recursive: true, force: true });
});

test.use({ serviceWorkers: "block", reducedMotion: "reduce", ignoreHTTPSErrors: true });
test.beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  delete process.env.APP_PUBLIC_ACCESS;
  Object.assign(process.env, {
    APP_ACCESS_TOKEN: TOKEN,
    APP_SESSION_SECRET: "b".repeat(43),
    VERCEL_ENV: "production",
  });
});
test.afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 640, height: 400 }, { width: 1280, height: 800 }]) {
  test(`locked browser recovers in the same storage after a network retry at ${viewport.width}px`, async ({ context, page, browserName }, testInfo) => {
    await page.setViewportSize(viewport);
    const harness = await mockEnrollment(context, { failFirstPost: true });
    const pageErrors: string[] = [];
    const consoleMessages: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => consoleMessages.push(message.text()));

    const lockedResponse = await page.goto(ORIGIN);
    expect(lockedResponse?.status()).toBe(403);
    expect(lockedResponse?.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
    await seedOfflineWork(page);
    const recoveryLink = page.getByRole("link", { name: "Unlock this browser", exact: true });
    expect((await recoveryLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await recoveryLink.click();
    await expect(page).toHaveURL(`${ORIGIN}/access`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive");

    const input = page.getByLabel("Private unlock link or token", { exact: true });
    const button = page.getByRole("button", { name: "Unlock this browser", exact: true });
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveAttribute("autocomplete", "off");
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(button).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`access-${viewport.width}.png`), fullPage: true });

    await input.fill(unlockLink());
    await button.click();
    await expect(page.getByRole("status")).toHaveText("Could not connect to Poke Deal. Check your connection and try again.");
    await expect(input).toHaveValue(unlockLink());
    await expect(button).toBeEnabled();
    await expect(page).toHaveURL(`${ORIGIN}/access`);
    await button.click();
    await expect(page.getByRole("heading", { name: "Poke Deal ready", exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${ORIGIN}/`);
    expect(harness.posts).toHaveLength(2);
    expect(harness.posts.every((body) => body === JSON.stringify({ token: TOKEN }))).toBe(true);
    expect(harness.cookieIsHostOnly).toBe(true);
    expect(harness.unexpectedRequests).toEqual([]);
    const cookie = (await context.cookies(ORIGIN)).find((entry) => entry.name === APP_ACCESS_COOKIE);
    expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: "Strict", path: "/", domain: "127.0.0.1" });
    expect(cookie?.value.includes(TOKEN)).toBe(false);
    expect(await hasOfflineWork(page)).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(consoleMessages.some((message) => message.includes(TOKEN))).toBe(false);
  });
}

test("manual input rejects malformed and foreign links before any token exchange", async ({ context, page }) => {
  const harness = await mockEnrollment(context);
  await page.goto(`${ORIGIN}/access`);
  const input = page.getByLabel("Private unlock link or token", { exact: true });
  for (const invalid of [
    "not-a-token", `https://other.test/access#${TOKEN}`, `${ORIGIN}/other#${TOKEN}`,
    `${ORIGIN}/access?token=${TOKEN}#${TOKEN}`, `${ORIGIN.replace("https://", "https://user@")}/access#${TOKEN}`,
  ]) {
    await input.fill(invalid);
    await page.getByRole("button", { name: "Unlock this browser", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Paste a complete unlock link for this Poke Deal address");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveValue(invalid);
    await expect(page).toHaveURL(`${ORIGIN}/access`);
    expect(harness.posts).toHaveLength(0);
  }
  await input.fill(TOKEN);
  await page.getByRole("button", { name: "Unlock this browser", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Poke Deal ready" })).toBeVisible();
  expect(harness.posts).toHaveLength(1);
});

test("an invalid token stays editable and can be replaced with the active token", async ({ context, page }) => {
  const harness = await mockEnrollment(context);
  await page.goto(`${ORIGIN}/access`);
  const input = page.getByLabel("Private unlock link or token", { exact: true });
  const invalidToken = "x".repeat(43);
  await input.fill(invalidToken);
  await page.getByRole("button", { name: "Unlock this browser", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("This unlock link is invalid or no longer active");
  await expect(input).toHaveValue(invalidToken);
  await input.fill(TOKEN);
  await page.getByRole("button", { name: "Unlock this browser", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Poke Deal ready" })).toBeVisible();
  expect(harness.posts).toHaveLength(2);
});

test("fragment enrollment scrubs the address before exchanging and still opens the app", async ({ context, page }) => {
  let observedAddress = "";
  const harness = await mockEnrollment(context, {
    beforePost: async () => { observedAddress = await page.evaluate(() => location.href); },
  });
  await page.goto(unlockLink());
  await expect(page.getByRole("heading", { name: "Poke Deal ready" })).toBeVisible();
  expect(observedAddress).toBe(`${ORIGIN}/access`);
  expect(harness.posts).toEqual([JSON.stringify({ token: TOKEN })]);
});

test("an oversized automatic fragment is scrubbed and rejected without a POST", async ({ context, page }) => {
  const harness = await mockEnrollment(context);
  await page.goto(`${ORIGIN}/access#${"x".repeat(1_025)}`);
  await expect(page).toHaveURL(`${ORIGIN}/access`);
  await expect(page.getByRole("status")).toContainText("Paste a complete unlock link");
  expect(harness.posts).toHaveLength(0);
});

test("an unconfirmed successful HTTP response retains the token for retry", async ({ context, page }) => {
  const harness = await mockEnrollment(context, { unconfirmedFirstPost: true });
  await page.goto(`${ORIGIN}/access`);
  const input = page.getByLabel("Private unlock link or token", { exact: true });
  await input.fill(TOKEN);
  await page.getByRole("button", { name: "Unlock this browser", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Access was not confirmed. Try again.");
  await expect(input).toHaveValue(TOKEN);
  await expect(page).toHaveURL(`${ORIGIN}/access`);
  await page.getByRole("button", { name: "Unlock this browser", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Poke Deal ready" })).toBeVisible();
  expect(harness.posts).toHaveLength(2);
});

async function mockEnrollment(context: BrowserContext, options: {
  failFirstPost?: boolean;
  unconfirmedFirstPost?: boolean;
  beforePost?: () => Promise<void>;
} = {}) {
  const state = { posts: [] as string[], cookieIsHostOnly: false, unexpectedRequests: [] as string[] };
  if (options.failFirstPost) {
    // Abort before transport so browsers cannot silently retry a closed socket.
    await context.route(`${ORIGIN}/access`, async (route) => {
      if (route.request().method() === "POST" && state.posts.length === 0) {
        state.posts.push(route.request().postData() ?? "");
        return route.abort("failed");
      }
      return route.continue();
    });
  }
  serveEnrollment = async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/access" && request.method === "POST") {
      const body = await request.text();
      state.posts.push(body);
      await options.beforePost?.();
      if (options.unconfirmedFirstPost && state.posts.length === 1) {
        return Response.json({});
      }
      const response = await POST(new Request(request.url, {
        method: "POST", headers: request.headers, body,
      }));
      const cookie = response.headers.get("set-cookie");
      if (cookie) state.cookieIsHostOnly = !/domain=/i.test(cookie);
      return response;
    }
    if ((url.pathname === "/" || url.pathname === "/access") && request.method === "GET") {
      const response = await middleware(new NextRequest(request.url, { headers: request.headers }));
      if (response.headers.get("x-middleware-next") === "1") {
        return new Response('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><main id="main-content"><h1>Poke Deal ready</h1></main></body></html>', { headers: { "Content-Type": "text/html" } });
      }
      return response;
    }
    state.unexpectedRequests.push(`${request.method} ${url.pathname}`);
    return new Response("Unexpected synthetic test request", { status: 404 });
  };
  return state;
}

async function seedOfflineWork(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("poke-deal-offline", 3);
    request.onupgradeneeded = () => request.result.createObjectStore("mutation-queue", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("mutation-queue", "readwrite");
      transaction.objectStore("mutation-queue").put({ id: "pending-sale-sentinel", quantity: 1 });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
}

async function hasOfflineWork(page: Page) {
  return page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open("poke-deal-offline", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("mutation-queue").objectStore("mutation-queue").get("pending-sale-sentinel");
      read.onsuccess = () => { db.close(); resolve(read.result?.quantity === 1); };
      read.onerror = () => reject(read.error);
    };
  }));
}
