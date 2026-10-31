import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "playwright/test";

/**
 * Phone recovery after a scan failure or a comp miss.
 * Example fixture data only. External hosts are aborted.
 */

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// /opt/cursor is not writable on a Mac (EACCES). Cloud runs can set SELL_RECOVERY_SHOTS.
const SHOTS = path.resolve(
  process.env.SELL_RECOVERY_SHOTS?.trim() || path.join(process.cwd(), "test-results", "sell-recovery"),
);
const PHOTO = path.join(process.cwd(), "public", "icon-512.png");
const LEAK = "GEMINI_API_KEY is not set. upstream exploded";

const CARD = {
  id: "card-fixture-gengar", tcgApiId: "swsh11tg-TG06", name: "Gengar", setName: "Lost Origin Trainer Gallery",
  setCode: "swsh11tg", number: "TG06/TG30", imageUrl: null, displayImageUrl: null, game: "POKEMON", language: "EN",
};

test.setTimeout(90_000);
fs.mkdirSync(SHOTS, { recursive: true });

function compResult(sampleSize: number, medianPence: number) {
  const asOf = new Date().toISOString();
  return {
    source: "checked-comps", card: CARD, grade: "RAW", currency: "GBP", medianPence,
    meanPence: medianPence, lowPence: Math.max(0, medianPence - 300), highPence: medianPence + 300,
    sampleSize, windowDays: 90, trendPct: null, outliersRemoved: 0, asOf,
  };
}

function emptyCompBody() {
  const asOf = new Date().toISOString();
  const empty = compResult(0, 0);
  const receipt = {
    headline: empty,
    all: [empty],
    sourcesDisagree: false,
    reconciliation: {
      headlinePence: null, confidence: "none", manualCheck: true, reasons: ["no sold comps"], chosenSource: null, trendPct: null,
    },
    catalog: CARD,
    alternatives: [],
    ambiguous: false,
    psaCert: null,
    cardImage: { imageUrl: null, source: "none", listingSafe: false },
    askEvidence: { source: "ebay-browse", marketplaceId: "EBAY_GB", query: "Gengar", asOf, count: 0, listings: [], lowestPence: null, undercutPence: null, skipped: true },
  };
  const base = { version: 1, lookupId: "lookup-empty-gengar", emittedAt: asOf };
  const events = [
    { ...base, sequence: 1, type: "catalog", requested: CARD, identity: CARD, grade: "RAW", catalog: CARD, ambiguity: false, sources: [{ name: "checked-comps", live: true }] },
    { ...base, sequence: 2, type: "source", source: { name: "checked-comps", live: true }, status: "empty", latencyMs: 8, completed: 1, total: 1, result: empty, receipt },
    { ...base, sequence: 3, type: "verdict", phase: "quorum", ambiguity: false, pricedSourceCount: 0, receipt },
    { ...base, sequence: 4, type: "receipt", latencyMs: 12, receipt },
  ];
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

async function phone(browser: Browser, baseURL: string, width: number, height: number) {
  const context = await browser.newContext({
    baseURL, viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    serviceWorkers: "block", userAgent: IPHONE,
  });
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "127.0.0.1" || host === "localhost") return route.fallback();
    return route.abort();
  });
  return context;
}

function keepPopupsOff(context: BrowserContext, page: Page) {
  context.on("page", (popup) => {
    if (popup !== page) void popup.close();
  });
}

async function mockApis(context: BrowserContext, comp: "empty" | "error") {
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(body),
    });
    if (url.pathname === "/api/comps/stream") {
      if (comp === "error") return json({ error: LEAK }, 500);
      return route.fulfill({
        status: 200, contentType: "application/x-ndjson", headers: { "Cache-Control": "no-store" },
        body: emptyCompBody(),
      });
    }
    if (url.pathname === "/api/inventory") return json({ items: [] });
    if (url.pathname === "/api/listings") return json({ listings: [] });
    if (url.pathname === "/api/dashboard") return json({
      metrics: {
        stockCount: 0, listedCount: 0, soldCount: 0, reservedCount: 0, activeCostPence: 0, soldCostPence: 0,
        realizedRevenuePence: 0, realizedFeesPence: 0, realizedPostagePence: 0, realizedProfitPence: 0,
        operatingExpensePence: 0, netProfitPence: 0, cashInPence: 0, cashOutPence: 0, cashNetPence: 0,
        cashRecoveryPct: 0, realizedMarginPct: null, sellThroughPct: 0, averageAgeDays: 0, agedStockCount: 0,
        channelBreakdown: [], bestSale: null, worstSale: null,
      },
      listingsByState: { DRAFT: 0, ACTIVE: 0, SOLD: 0, ENDED: 0 },
      staleStock: [], recentSales: [], recentExpenses: [], monthlyPnl: [],
    });
    if (url.pathname === "/api/snapshots/portfolio") return json({ points: [], latest: null, previous: null, changePence: null, changePct: null });
    if (url.pathname === "/api/watches") return json({ watches: [] });
    if (url.pathname === "/api/alerts/inbox") return json({ alerts: [], unreadCount: 0 });
    if (url.pathname === "/api/expenses") return json({ expenses: [] });
    if (url.pathname === "/api/system/status") return json({ sources: [], summary: { livePrimaryComps: true, secondaryCrossCheck: true, alertDelivery: false, storedSales: false } });
    if (url.pathname === "/api/deal-sessions") return json({ session: null, summary: { includedCount: 0, excludedCount: 0, totalMaxCashPence: 0, totalMaxTradePence: 0, totalExpectedProceedsPence: 0, totalExpectedProfitPence: 0, suggestedBundleOfferPence: 0, completionReady: false, completionBlockers: [] } });
    if (url.pathname === "/api/comps/reviews") return json({ reviews: [], nextCursor: null });
    if (url.pathname === "/api/ebay/status") return json({ configured: false, connected: false });
    if (url.pathname === "/api/catalog/sets" || url.pathname === "/api/catalog/search") return json({ sets: [] });
    if (url.pathname === "/api/catalog/cards") return json({ cards: [] });
    return json({});
  });
}

async function resetStorage(page: Page) {
  await page.goto("/privacy");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("poke-deal-offline");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}

async function uploadScan(page: Page, status: number) {
  await page.context().route("**/api/scan", (route) => route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ error: LEAK }),
  }));
  await page.goto("/?view=buy");
  await page.getByRole("button", { name: "Scan a card", exact: true }).click();
  await page.locator("#scan-photo-upload").setInputFiles(PHOTO);
}

function recovery(page: Page, title: string) {
  return page.getByRole("region", { name: title });
}

async function actionsFit(region: Locator, viewport: { width: number; height: number }) {
  const buttons = region.getByRole("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  await expect.poll(async () => {
    const box = await buttons.first().boundingBox();
    return box ? Math.round(box.y) : 9_999;
  }).toBeLessThan(viewport.height - 44);
  for (let index = 0; index < count; index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.y).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  }
  const overflow = await region.page().evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, name) });
}

test("a failed scan on a phone offers retake, upload and typing", async ({ browser, baseURL }) => {
  for (const [width, height, file] of [[375, 667, "scan-fail-375x667.png"], [390, 844, "scan-fail-390x844.png"]] as const) {
    const context = await phone(browser, baseURL!, width, height);
    await mockApis(context, "empty");
    const page = await context.newPage();
    keepPopupsOff(context, page);
    try {
      await resetStorage(page);
      await uploadScan(page, 422);
      const card = recovery(page, "Couldn't read that card");
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText("Couldn't read that photo. Try better light or fill the frame, or type it.");
      await expect(page.locator("body")).not.toContainText("GEMINI");
      await expect(page.locator("body")).not.toContainText("upstream");
      await expect(page.locator(".toast")).toHaveCount(0);
      await expect(card.getByRole("button", { name: "Retake photo", exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Upload another photo", exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Type the card", exact: true })).toBeVisible();
      await actionsFit(card, { width, height });
      await shot(page, file);
      if (width === 390) {
        await card.getByRole("button", { name: "Type the card", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Scan a card" })).toBeHidden();
        await expect(page.locator("#quick-intake")).toBeFocused();
      }
    } finally {
      await context.close();
    }
  }
});

test("a down scanner can be left for a typed card, and a retake clears the failure", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 375, 667);
  await mockApis(context, "empty");
  const page = await context.newPage();
  keepPopupsOff(context, page);
  try {
    await resetStorage(page);
    await uploadScan(page, 503);
    const card = recovery(page, "Card scan is down");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("Scanning is unavailable right now.");
    await expect(page.locator("body")).not.toContainText("GEMINI");
    await card.getByRole("button", { name: "Try a photo again", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Scan a card" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a scanned card with no sold comps keeps every exit on the first screen", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 375, 667);
  await mockApis(context, "empty");
  await context.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      identity: {
        name: "Gengar", setName: "Lost Origin Trainer Gallery", setCode: "swsh11tg", number: "TG06/TG30",
        language: "English", isSlab: false, grader: null, grade: null, certNumber: null, stamps: [], readable: true, notes: "",
      },
      model: "fixture-vision-v1",
      scanEventId: "scan-fixture-gengar",
    }),
  }));
  const page = await context.newPage();
  keepPopupsOff(context, page);
  try {
    await resetStorage(page);
    await page.goto("/?view=buy");
    await page.getByRole("button", { name: "Scan a card", exact: true }).click();
    await page.locator("#scan-photo-upload").setInputFiles(PHOTO);
    const card = recovery(page, "No sold comps for this card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("No sold comps for Gengar");
    await expect(card.getByRole("button", { name: "Try the price again", exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Check UK solds", exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Type a different card", exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Add what you paid", exact: true })).toBeVisible();
    await actionsFit(card, { width: 375, height: 667 });
    await expect(page.getByRole("button", { name: "Continue to stock", exact: true })).toHaveCount(0);
    await shot(page, "scan-comp-miss-375x667.png");
    await card.getByRole("button", { name: "Check UK solds", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Scan a card" })).toBeHidden();
    await expect(page.getByText("Log the sold prices you saw")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a typed card with no sold comps can move to cost or a new search", async ({ browser, baseURL }) => {
  for (const [width, height, file] of [[375, 667, "comp-miss-375x667.png"], [390, 844, "comp-miss-390x844.png"]] as const) {
    const context = await phone(browser, baseURL!, width, height);
    await mockApis(context, "empty");
    const page = await context.newPage();
    keepPopupsOff(context, page);
    try {
      await resetStorage(page);
      await page.goto("/?view=buy");
      await page.getByText("Exact card details", { exact: true }).click();
      await page.getByLabel("Card", { exact: true }).fill("Gengar");
      await page.getByRole("button", { name: "Comp current card" }).click();
      const card = recovery(page, "No sold comps for this card");
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText("No sold comps for Gengar");
      await expect(page.locator(".comp-hero")).toContainText("No auto-offer");
      await actionsFit(card, { width, height });
      await shot(page, file);
      if (width === 375) {
        await card.getByRole("button", { name: "Add what you paid", exact: true }).click();
        await expect(page.locator(".fallback-stock-panel").getByLabel(/What I paid/)).toBeFocused();
      } else {
        await card.getByRole("button", { name: "Type a different card", exact: true }).click();
        await expect(page.locator("#quick-intake")).toBeFocused();
        await expect(card).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  }
});

test("a failed price check keeps Retry and adds a way out", async ({ browser, baseURL }) => {
  for (const [width, height, file] of [[375, 667, "comp-fail-375x667.png"], [390, 844, "comp-fail-390x844.png"]] as const) {
    const context = await phone(browser, baseURL!, width, height);
    await mockApis(context, "error");
    let streams = 0;
    await context.route("**/api/comps/stream**", async (route) => {
      streams += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: LEAK }) });
    });
    const page = await context.newPage();
    keepPopupsOff(context, page);
    try {
      await resetStorage(page);
      await page.goto("/?view=buy");
      await page.getByText("Exact card details", { exact: true }).click();
      await page.getByLabel("Card", { exact: true }).fill("Gengar");
      await page.getByRole("button", { name: "Comp current card" }).click();
      const alert = page.locator(".comp-lookup-alert");
      await expect(alert).toBeVisible({ timeout: 30_000 });
      await expect(alert).toContainText("Couldn't check this price. Check signal and try again.");
      await expect(alert).not.toContainText("GEMINI");
      await expect(page.locator(".toast")).toHaveCount(0);
      const card = recovery(page, "What you can do next");
      await expect(card).toBeVisible();
      await expect(card.getByRole("button", { name: "Check UK solds", exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Type a different card", exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Add what you paid", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open UK", exact: true })).toHaveCount(0);
      await expect(page.locator(".mobile-buy-action")).toHaveCount(0);
      await actionsFit(card, { width, height });
      await shot(page, file);
      if (width === 390) {
        const before = streams;
        await alert.getByRole("button", { name: "Retry", exact: true }).click();
        await expect.poll(() => streams).toBe(before + 1);
        await expect(alert).toContainText("Couldn't check this price. Check signal and try again.");
        await card.getByRole("button", { name: "Add what you paid", exact: true }).click();
        await expect(page.locator(".fallback-stock-panel").getByLabel(/What I paid/)).toBeFocused();
      }
    } finally {
      await context.close();
    }
  }
});
