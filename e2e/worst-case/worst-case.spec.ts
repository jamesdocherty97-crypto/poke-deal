/**
 * Dev-only layout stress harness. Example data. Not part of npm run test:e2e.
 * Run: npx playwright test --config e2e/worst-case/playwright.config.ts
 */
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "playwright/test";
import {
  FIXTURE_LABEL,
  WORST_COMP_QUERY,
  bookFor,
  dashboardFor,
  worstCompEvents,
  type WorstCaseMode,
} from "./fixtures";

const SHOTS = path.resolve(process.cwd(), "../shots");
const IPHONE_16_PRO_MAX = { width: 440, height: 956 };
const IPHONE_16_PRO = { width: 430, height: 932 };
const NARROW = { width: 320, height: 720 };

type Size = { width: number; height: number };

const findings: Array<Record<string, unknown>> = [];

test.afterAll(async () => {
  await writeFindings();
});

async function writeFindings() {
  const fs = await import("node:fs/promises");
  await fs.mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, "p1-audit.json");
  let previous: Array<Record<string, unknown>> = [];
  try {
    const saved = JSON.parse(await fs.readFile(file, "utf8")) as { findings?: Array<Record<string, unknown>> };
    previous = saved.findings ?? [];
  } catch {
    previous = [];
  }
  const merged = [...previous.filter((row) => !findings.some((next) => JSON.stringify(next) === JSON.stringify(row))), ...findings];
  await fs.writeFile(file, JSON.stringify({ fixture: FIXTURE_LABEL, findings: merged }, null, 2));
}

test("worst-case stock, listings, today and buy at phone sizes", async ({ browser }, testInfo) => {
  test.setTimeout(360_000);
  const sizes: Array<{ size: Size; tag: string; spot: boolean }> = [
    { size: IPHONE_16_PRO_MAX, tag: "440x956", spot: false },
    { size: IPHONE_16_PRO, tag: "430x932", spot: true },
    { size: NARROW, tag: "320x720", spot: true },
  ];

  for (const { size, tag, spot } of sizes) {
    const modes: WorstCaseMode[] = spot ? ["worst"] : ["worst", "empty", "one", "demo"];
    for (const mode of modes) {
      const context = await phoneContext(browser, size);
      const page = await context.newPage();
      const notes: string[] = [];
      page.on("pageerror", (error) => notes.push(`pageerror: ${error.message}`));
      await installApi(page, mode);
      try {
        await shotView(page, testInfo, "today", mode, tag, "/?view=today");
        await shotView(page, testInfo, "stock", mode, tag, "/?view=stock");
        await shotView(page, testInfo, "list", mode, tag, "/?view=list");
        if (mode === "worst") await shotBuy(page, testInfo, tag, "loaded");
      } finally {
        if (notes.length) findings.push({ kind: "pageerror", mode, tag, notes });
        await context.close();
      }
    }
  }

  await shotLoadingAndErrors(browser, testInfo);
  await shotThousand(browser, testInfo);
  await shotZoomAndTheme(browser, testInfo);
  await shotMobileNative(browser, testInfo);
});

test("webkit spot-check of worst stock if the browser launches", async ({ playwright }, testInfo) => {
  let browser: Browser;
  try {
    browser = await playwright.webkit.launch();
  } catch (error) {
    findings.push({ kind: "webkit", launched: false, error: error instanceof Error ? error.message : String(error) });
    testInfo.skip(true, "WebKit did not launch");
    return;
  }
  const context = await phoneContext(browser, IPHONE_16_PRO_MAX);
  const page = await context.newPage();
  await installApi(page, "worst");
  await page.goto("/?view=stock", { waitUntil: "domcontentloaded" });
  await page.locator(".inventory-workspace .item-row").first().waitFor({ timeout: 20_000 });
  await stamp(page, `${FIXTURE_LABEL} · Worst case · WebKit`);
  await page.screenshot({ path: path.join(SHOTS, "p1-stock-worst-webkit-440x956.png") });
  findings.push({ kind: "webkit", launched: true, overflow: await overflowAudit(page) });
  await context.close();
  await browser.close();
});

async function shotView(page: Page, testInfo: TestInfo, view: string, mode: WorstCaseMode, tag: string, url: string) {
  const started = Date.now();
  const root = view === "list" ? ".listings-workspace" : view === "today" ? ".today-workspace" : ".inventory-workspace";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(root).waitFor({ timeout: 20_000 });
    await page.locator(".workspace-skeleton").waitFor({ state: "detached", timeout: 20_000 }).catch(() => undefined);
  } catch (error) {
    findings.push({ kind: "wait-failed", view, mode, tag, error: error instanceof Error ? error.message : String(error) });
  }
  await stamp(page, `${FIXTURE_LABEL} · ${labelFor(mode)}`);
  const file = `p1-${view}-${mode}-${tag}.png`;
  await page.screenshot({ path: path.join(SHOTS, file) }).catch((error: unknown) => {
    findings.push({ kind: "shot-failed", file, error: error instanceof Error ? error.message : String(error) });
  });
  const audit = await overflowAudit(page).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
  findings.push({ kind: "view", view, mode, tag, file, ms: Date.now() - started, ...audit, test: testInfo.title });
  if (mode === "worst" && tag === "440x956" && (view === "stock" || view === "list" || view === "today")) {
    await page.evaluate(() => window.scrollTo(0, 720));
    await stamp(page, `${FIXTURE_LABEL} · Worst case · scrolled`);
    const scrolled = `p1-${view}-worst-scrolled-440x956.png`;
    await page.screenshot({ path: path.join(SHOTS, scrolled) });
    findings.push({ kind: "view", view, mode: "worst-scrolled", tag, file: scrolled, ...await overflowAudit(page) });
  }
}

async function shotBuy(page: Page, testInfo: TestInfo, tag: string, phase: "loaded" | "slow" | "error") {
  await page.goto("/?view=buy", { waitUntil: "domcontentloaded" });
  const search = page.getByLabel("Smart comp search");
  await search.waitFor({ timeout: 20_000 });
  await search.fill(WORST_COMP_QUERY);
  const field = await page.evaluate(() => {
    const input = document.querySelector("input");
    if (!(input instanceof HTMLInputElement)) return null;
    const style = getComputedStyle(input);
    return { fontSize: style.fontSize, scrollWidth: input.scrollWidth, clientWidth: input.clientWidth, value: input.value.slice(0, 80) };
  });
  findings.push({ kind: "buy-field", tag, phase, field });
  if (phase === "loaded") {
    await page.getByRole("button", { name: "Comp current card" }).click();
    await page.getByText("Suggested maximum buy").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    const priceBox = await page.locator(".comp-hero h2").boundingBox();
    findings.push({ kind: "buy-price-box", tag, priceBox });
    await stamp(page, `${FIXTURE_LABEL} · Worst case · Buy`);
    const file = `p1-buy-worst-${tag}.png`;
    await page.screenshot({ path: path.join(SHOTS, file) });
    findings.push({ kind: "view", view: "buy", mode: "worst", tag, file, ...await overflowAudit(page), test: testInfo.title });
    const price = await page.locator(".comp-hero h2").innerText();
    findings.push({ kind: "buy-price", tag, price });
  }
}

async function shotLoadingAndErrors(browser: Browser, testInfo: TestInfo) {
  const context = await phoneContext(browser, IPHONE_16_PRO_MAX);
  const page = await context.newPage();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await installApi(page, "slow", gate);
  const views: Array<[string, string]> = [["stock", "/?view=stock"], ["list", "/?view=list"], ["today", "/?view=today"]];
  for (const [view, url] of views) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(".workspace-skeleton").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    const indicators = await page.evaluate(() => ({
      skeletons: document.querySelectorAll(".workspace-skeleton, .skeleton-row, .skeleton-hero, .lookup-skeleton, .market-pipeline.loading").length,
      refreshSpinning: Boolean(document.querySelector(".icon-button.is-loading")),
      pullRefresh: Boolean(document.querySelector(".pull-refresh.visible")),
      blankMain: (document.querySelector("#main-content")?.textContent ?? "").trim().length < 40,
    }));
    await stamp(page, `${FIXTURE_LABEL} · Slow · 5s`);
    const file = `p1-${view}-slow-440x956.png`;
    await page.screenshot({ path: path.join(SHOTS, file) });
    findings.push({ kind: "slow", view, file, indicators, test: testInfo.title });
  }
  release();
  await page.locator(".workspace-skeleton").waitFor({ state: "detached", timeout: 20_000 }).catch(() => undefined);
  await context.close();

  const errorContext = await phoneContext(browser, IPHONE_16_PRO_MAX);
  const errorPage = await errorContext.newPage();
  await installApi(errorPage, "error");
  for (const [view, url] of views) {
    await errorPage.goto(url, { waitUntil: "domcontentloaded" });
    await errorPage.waitForTimeout(800);
    await stamp(errorPage, `${FIXTURE_LABEL} · Error · HTTP 500`);
    const file = `p1-${view}-error-440x956.png`;
    await errorPage.screenshot({ path: path.join(SHOTS, file) });
    const text = await errorPage.locator("body").innerText();
    findings.push({
      kind: "error",
      view,
      file,
      hasRetry: /retry/i.test(text),
      claimsEmpty: /No active stock|No matching listings|Load your existing singles/.test(text),
      alert: (await errorPage.getByRole("alert").allInnerTexts().catch(() => [])).slice(0, 4),
      test: testInfo.title,
    });
  }
  await errorContext.close();

  const offlineContext = await phoneContext(browser, IPHONE_16_PRO_MAX);
  const offlinePage = await offlineContext.newPage();
  await installApi(offlinePage, "worst");
  await offlinePage.goto("/?view=today", { waitUntil: "domcontentloaded" });
  await offlinePage.getByRole("heading", { level: 2 }).first().waitFor({ timeout: 20_000 });
  await offlineContext.setOffline(true);
  await offlinePage.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await offlinePage.getByRole("button", { name: "Refresh data" }).click();
  await offlinePage.getByRole("alert").waitFor({ timeout: 15_000 }).catch(() => undefined);
  await offlinePage.waitForTimeout(400);
  await stamp(offlinePage, `${FIXTURE_LABEL} · Offline after a successful load`);
  await offlinePage.screenshot({ path: path.join(SHOTS, "p1-today-offline-440x956.png") });
  findings.push({ kind: "offline-after-load", text: (await offlinePage.locator("body").innerText()).slice(0, 700) });
  await offlineContext.close();

  const buyContext = await phoneContext(browser, IPHONE_16_PRO_MAX);
  const buyPage = await buyContext.newPage();
  let releaseBuy!: () => void;
  const buyGate = new Promise<void>((resolve) => { releaseBuy = resolve; });
  await installApi(buyPage, "worst", undefined, buyGate);
  await buyPage.goto("/?view=buy", { waitUntil: "domcontentloaded" });
  await buyPage.getByLabel("Smart comp search").fill(WORST_COMP_QUERY);
  await buyPage.getByRole("button", { name: "Comp current card" }).click();
  await buyPage.locator(".lookup-progress-card, .lookup-skeleton, .comp-progress-with-cancel").first().waitFor({ timeout: 10_000 });
  await buyPage.waitForTimeout(500);
  const buyIndicators = await buyPage.evaluate(() => ({
    skeleton: Boolean(document.querySelector(".lookup-skeleton")),
    progress: Boolean(document.querySelector(".lookup-progress-card, .comp-progress-with-cancel")),
    cancel: Boolean([...document.querySelectorAll("button")].find((button) => /cancel/i.test(button.textContent ?? ""))),
    hero: document.querySelector(".comp-hero h2")?.textContent ?? null,
  }));
  await stamp(buyPage, `${FIXTURE_LABEL} · Slow · Buy`);
  await buyPage.screenshot({ path: path.join(SHOTS, "p1-buy-slow-440x956.png") });
  findings.push({ kind: "buy-slow", buyIndicators });
  releaseBuy();
  await buyPage.getByText("Suggested maximum buy").waitFor({ timeout: 20_000 });
  await buyContext.close();

  const buyErrorContext = await phoneContext(browser, IPHONE_16_PRO_MAX);
  const buyError = await buyErrorContext.newPage();
  await installApi(buyError, "worst", undefined, undefined, true);
  await buyError.goto("/?view=buy", { waitUntil: "domcontentloaded" });
  await buyError.getByLabel("Smart comp search").fill("Flabébé Pokémon");
  await buyError.getByRole("button", { name: "Comp current card" }).click();
  await buyError.waitForTimeout(1_000);
  await stamp(buyError, `${FIXTURE_LABEL} · Error · Buy`);
  await buyError.screenshot({ path: path.join(SHOTS, "p1-buy-error-440x956.png") });
  findings.push({
    kind: "buy-error",
    text: (await buyError.locator("body").innerText()).slice(0, 800),
    hasCancel: await buyError.getByRole("button", { name: /cancel/i }).count(),
  });
  await buyErrorContext.close();
}

async function shotThousand(browser: Browser, testInfo: TestInfo) {
  const context = await phoneContext(browser, IPHONE_16_PRO_MAX);
  const page = await context.newPage();
  await installApi(page, "thousand");
  const started = Date.now();
  await page.goto("/?view=stock", { waitUntil: "domcontentloaded" });
  await page.locator(".inventory-workspace .item-row").first().waitFor({ timeout: 60_000 });
  const renderMs = Date.now() - started;
  const counts = await page.evaluate(() => ({
    rows: document.querySelectorAll(".inventory-workspace .item-row").length,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  await stamp(page, `${FIXTURE_LABEL} · 1,000 rows`);
  await page.screenshot({ path: path.join(SHOTS, "p1-stock-thousand-440x956.png") });
  findings.push({ kind: "thousand", renderMs, ...counts, overflow: await overflowAudit(page), test: testInfo.title });
  await context.close();
}

async function shotZoomAndTheme(browser: Browser, testInfo: TestInfo) {
  const context = await phoneContext(browser, IPHONE_16_PRO_MAX);
  const page = await context.newPage();
  await installApi(page, "worst");
  await page.goto("/?view=stock", { waitUntil: "domcontentloaded" });
  await page.locator(".inventory-workspace .item-row").first().waitFor({ timeout: 20_000 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  await stamp(page, `${FIXTURE_LABEL} · Worst case · 200% root font`);
  await page.screenshot({ path: path.join(SHOTS, "p1-stock-worst-zoom200-440x956.png") });
  findings.push({ kind: "zoom", ...await overflowAudit(page), test: testInfo.title });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
    document.documentElement.dataset.theme = "light";
  });
  await stamp(page, `${FIXTURE_LABEL} · Worst case · light tokens`);
  await page.screenshot({ path: path.join(SHOTS, "p1-stock-worst-light-440x956.png") });
  findings.push({ kind: "light", ...await overflowAudit(page) });
  await context.close();
}

async function shotMobileNative(browser: Browser, testInfo: TestInfo) {
  const context = await phoneContext(browser, IPHONE_16_PRO_MAX);
  const page = await context.newPage();
  await installApi(page, "one");
  await page.goto("/?view=buy", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Smart comp search").waitFor();
  const native = await page.evaluate(() => {
    const metas = [...document.querySelectorAll("meta")].map((meta) => ({
      name: meta.getAttribute("name"),
      content: meta.getAttribute("content"),
      media: meta.getAttribute("media"),
    })).filter((meta) => meta.name === "viewport" || meta.name === "theme-color" || meta.name === "color-scheme");
    const html = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const shell = document.querySelector(".app-shell");
    const shellStyle = shell ? getComputedStyle(shell) : null;
    const controls = [...document.querySelectorAll("button, a, input, select, textarea, summary")].slice(0, 12).map((el) => {
      const style = getComputedStyle(el);
      return {
        tag: el.tagName,
        text: (el.textContent ?? "").trim().slice(0, 40),
        fontSize: style.fontSize,
        userSelect: style.userSelect,
        touchAction: style.touchAction,
        tapHighlight: style.getPropertyValue("-webkit-tap-highlight-color"),
      };
    });
    return {
      metas,
      htmlOverscroll: html.overscrollBehavior,
      bodyOverscroll: body.overscrollBehavior,
      tapHighlight: html.getPropertyValue("-webkit-tap-highlight-color") || body.getPropertyValue("-webkit-tap-highlight-color"),
      textSizeAdjust: html.getPropertyValue("-webkit-text-size-adjust"),
      shellMinHeight: shellStyle?.minHeight ?? null,
      shellHeight: shellStyle?.height ?? null,
      hoverHover: window.matchMedia("(hover: hover)").matches,
      pointerFine: window.matchMedia("(pointer: fine)").matches,
      pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
      controls,
      inputs: [...document.querySelectorAll("input, textarea, select")].map((el) => ({
        name: el.getAttribute("name") || el.getAttribute("aria-label") || el.getAttribute("placeholder"),
        fontSize: getComputedStyle(el).fontSize,
      })),
    };
  });
  findings.push({ kind: "mobile-native", native, test: testInfo.title });
  expect(native.metas.some((meta) => meta.name === "viewport")).toBe(true);
  await context.close();
}

async function phoneContext(browser: Browser, size: Size): Promise<BrowserContext> {
  return browser.newContext({
    viewport: size,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    serviceWorkers: "block",
  });
}

async function installApi(page: Page, mode: WorstCaseMode, gate?: Promise<void>, compGate?: Promise<void>, compError = false) {
  const book = bookFor(mode === "slow" ? "worst" : mode);
  const dashboard = dashboardFor(mode === "slow" ? "worst" : mode, book.items, book.listings);
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:3120") || url.startsWith("http://localhost:3120")) {
      return route.fallback();
    }
    return route.abort();
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    const critical = method === "GET" && ["/api/inventory", "/api/listings", "/api/dashboard"].includes(url.pathname);
    if (mode === "error" && critical) {
      return json({ error: "Example data: service unavailable" }, 500);
    }
    if (mode === "slow" && critical && gate) await gate;
    if (url.pathname === "/api/comps/stream") {
      if (compError) return json({ error: "Example data: comp lookup failed" }, 500);
      if (compGate) await compGate;
      const events = worstCompEvents();
      return route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      });
    }
    if (url.pathname === "/api/inventory" && method === "GET") return json({ items: book.items, priceHistoryPreviews: {} });
    if (url.pathname === "/api/listings" && method === "GET") return json({ listings: book.listings });
    if (url.pathname === "/api/dashboard") return json(dashboard);
    if (url.pathname === "/api/snapshots/portfolio") return json({ points: [], latest: null, previous: null, changePence: null, changePct: null });
    if (url.pathname === "/api/watches") return json({ watches: [] });
    if (url.pathname === "/api/alerts/inbox") return json({
      alerts: mode === "worst" || mode === "slow" ? [{
        id: "example-alert",
        title: "Price moved on リザードンex SAR スペシャルアートレア",
        message: "Example data only. This alert is not a live price.",
        readAt: null,
        createdAt: "2026-10-21T08:00:00.000Z",
      }] : [],
      unreadCount: mode === "worst" || mode === "slow" ? 1 : 0,
    });
    if (url.pathname === "/api/expenses") return json({ expenses: [] });
    if (url.pathname === "/api/system/status") return json({
      sources: [],
      summary: { livePrimaryComps: false, liveCatalogKey: false, secondaryCrossCheck: false, alertDelivery: false, storedSales: false },
    });
    if (url.pathname === "/api/deal-sessions") return json({
      session: null,
      summary: { includedCount: 0, excludedCount: 0, totalMaxCashPence: 0, totalMaxTradePence: 0, totalExpectedProceedsPence: 0, totalExpectedProfitPence: 0, suggestedBundleOfferPence: 0, completionReady: false, completionBlockers: [] },
    });
    if (url.pathname === "/api/comps/reviews") return json({ reviews: [], nextCursor: null });
    if (url.pathname === "/api/ebay/status") return json({ configured: false, connected: false });
    if (url.pathname === "/api/catalog/sets") return json({ sets: [] });
    if (url.pathname === "/api/catalog/cards") return json({ cards: [] });
    if (url.pathname === "/api/catalog/search") return json({ sets: [] });
    return json({});
  });
}

async function stamp(page: Page, label: string) {
  await page.evaluate((text) => {
    document.getElementById("worst-case-fixture-label")?.remove();
    const el = document.createElement("div");
    el.id = "worst-case-fixture-label";
    el.textContent = text;
    el.setAttribute("style", [
      "position:fixed",
      "left:50%",
      "bottom:84px",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "max-width:92vw",
      "background:#e5e7eb",
      "color:#111827",
      "font:600 12px/1.3 ui-sans-serif, system-ui, sans-serif",
      "padding:6px 10px",
      "border-radius:999px",
      "pointer-events:none",
      "white-space:nowrap",
    ].join(";"));
    document.body.appendChild(el);
  }, label);
}

async function overflowAudit(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const offenders: Array<Record<string, unknown>> = [];
    const nodes = document.querySelectorAll("body *");
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.id === "worst-case-fixture-label") continue;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const pastRight = rect.right > viewportWidth + 1;
      const pastLeft = rect.left < -1;
      const clipsText = node.scrollWidth > node.clientWidth + 4 && node.clientWidth > 0 && style.overflowX !== "visible" && style.overflow !== "visible";
      if ((pastRight || pastLeft) && offenders.length < 25) {
        offenders.push({
          tag: node.tagName,
          className: String(node.className).slice(0, 120),
          text: (node.innerText || "").trim().slice(0, 90),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          clipsText,
        });
      }
    }
    const images = [...document.querySelectorAll("img")].map((img) => ({
      alt: img.alt,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      src: img.currentSrc.slice(0, 80),
    }));
    return {
      viewportWidth,
      scrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > viewportWidth + 1,
      offenders,
      brokenImages: images.filter((img) => img.complete && img.naturalWidth === 0),
      inputFonts: [...document.querySelectorAll("input, textarea, select")].map((el) => getComputedStyle(el).fontSize),
    };
  });
}

function labelFor(mode: WorstCaseMode): string {
  if (mode === "demo") return "Demo data";
  if (mode === "worst") return "Worst case";
  if (mode === "empty") return "Empty";
  if (mode === "one") return "One";
  if (mode === "thousand") return "1,000 rows";
  if (mode === "slow") return "Slow";
  return "Error";
}
