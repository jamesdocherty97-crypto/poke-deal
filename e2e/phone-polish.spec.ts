import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "playwright/test";

/**
 * 390px and iPhone SE (375×667) polish for the scan sheet, Today, and binder filters.
 * Example fixture data only. External hosts are aborted.
 */

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// Cloud runs can set SHOTS. The default stays in the repo so a Mac is not
// asked to create /opt/cursor/artifacts (that path is EACCES there).
const SHOTS = path.resolve(process.env.SHOTS?.trim() || path.join(process.cwd(), "test-results", "phone-polish"));
const CARD = {
  id: "card-fixture-gengar", tcgApiId: "swsh11tg-TG06", name: "Gengar", setName: "Lost Origin Trainer Gallery",
  setCode: "swsh11tg", number: "TG06/TG30", imageUrl: null, displayImageUrl: null, game: "POKEMON", language: "EN",
};

test.setTimeout(90_000);

function compResult(source: string, medianPence: number, sampleSize: number, asOf: string) {
  return {
    source, card: CARD, grade: "RAW", currency: "GBP", medianPence, meanPence: medianPence,
    lowPence: medianPence - 300, highPence: medianPence + 300, sampleSize, windowDays: 90,
    trendPct: null, outliersRemoved: 1, asOf,
  };
}

function reconciled(all: ReturnType<typeof compResult>[]) {
  return {
    headline: all[0], all, sourcesDisagree: false,
    reconciliation: {
      headlinePence: all[0]?.medianPence ?? null,
      confidence: all.length > 1 ? "high" : "medium",
      manualCheck: false, reasons: [], chosenSource: all[0]?.source ?? null, trendPct: null,
    },
  };
}

function compEvents() {
  const asOf = new Date().toISOString();
  const checked = compResult("checked-comps", 4200, 7, asOf);
  const owned = compResult("owned-sales", 4100, 3, asOf);
  const partial = reconciled([checked]);
  const complete = reconciled([checked, owned, compResult("empty-source", 500, 0, asOf)]);
  const receipt = {
    ...complete, catalog: CARD, alternatives: [], ambiguous: false, psaCert: null,
    cardImage: { imageUrl: null, source: "none", listingSafe: false },
    askEvidence: { source: "ebay-browse", marketplaceId: "EBAY_GB", query: "Gengar", asOf, count: 0, listings: [], lowestPence: null, undercutPence: null, skipped: true },
  };
  const base = { version: 1, lookupId: "lookup-fixture-gengar", emittedAt: asOf };
  return [
    { ...base, sequence: 1, type: "catalog", requested: CARD, identity: CARD, grade: "RAW", catalog: CARD, ambiguity: false, sources: [{ name: "checked-comps", live: true }] },
    { ...base, sequence: 2, type: "source", source: { name: "checked-comps", live: true }, status: "priced", latencyMs: 12, completed: 1, total: 1, result: checked, receipt: partial },
    { ...base, sequence: 3, type: "verdict", phase: "provisional", ambiguity: false, pricedSourceCount: 1, receipt: partial },
    { ...base, sequence: 4, type: "source", source: { name: "owned-sales", live: true }, status: "priced", latencyMs: 18, completed: 2, total: 2, result: owned, receipt: complete },
    { ...base, sequence: 5, type: "verdict", phase: "quorum", ambiguity: false, pricedSourceCount: 2, receipt: complete },
    { ...base, sequence: 6, type: "receipt", latencyMs: 20, receipt },
  ];
}

function inventoryItem() {
  const createdAt = "2026-10-21T09:00:00.000Z";
  return {
    id: "item-fixture-gengar", card: CARD, grade: "RAW", quantity: 1, costBasis: 2500,
    acquiredFrom: "Card fair", location: "Binder", condition: "NM", graderCert: null,
    status: "IN_STOCK", createdAt, updatedAt: createdAt, sales: [], photos: [], listings: [],
  };
}

function dashboard() {
  return {
    metrics: {
      stockCount: 1, listedCount: 0, soldCount: 0, reservedCount: 0, activeCostPence: 2500, soldCostPence: 0,
      realizedRevenuePence: 0, realizedFeesPence: 0, realizedPostagePence: 0, realizedProfitPence: 0,
      operatingExpensePence: 0, netProfitPence: 0, cashInPence: 0, cashOutPence: 2500, cashNetPence: -2500,
      cashRecoveryPct: 0, realizedMarginPct: null, sellThroughPct: 0, averageAgeDays: 0, agedStockCount: 0,
      channelBreakdown: [], bestSale: null, worstSale: null,
    },
    listingsByState: { DRAFT: 0, ACTIVE: 0, SOLD: 0, ENDED: 0 },
    staleStock: [], recentSales: [], recentExpenses: [], monthlyPnl: [],
  };
}

async function phone(browser: Browser, baseURL: string, width: number, height: number) {
  const context = await browser.newContext({
    baseURL, viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    serviceWorkers: "block", userAgent: IPHONE,
  });
  await context.grantPermissions(["camera"]).catch(() => undefined);
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "127.0.0.1" || host === "localhost") return route.fallback();
    return route.abort();
  });
  return context;
}

async function mockApis(context: BrowserContext) {
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/scan") {
      return json({
        model: "fixture-vision-v1",
        scanEventId: "scan-fixture-gengar",
        identity: {
          name: "Gengar", setName: "Lost Origin Trainer Gallery", setCode: "swsh11tg", number: "TG06/TG30",
          language: "English", isSlab: false, grader: null, grade: null, certNumber: null, stamps: [], readable: true, notes: "",
        },
      });
    }
    if (url.pathname === "/api/comps/stream") {
      const events = compEvents();
      return route.fulfill({
        status: 200, contentType: "application/x-ndjson", headers: { "Cache-Control": "no-store" },
        body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      });
    }
    if (url.pathname === "/api/inventory") return json({ items: [inventoryItem()] });
    if (url.pathname === "/api/listings") return json({ listings: [] });
    if (url.pathname === "/api/dashboard") return json(dashboard());
    if (url.pathname === "/api/snapshots/portfolio") return json({ points: [], latest: null, previous: null, changePence: null, changePct: null });
    if (url.pathname === "/api/watches") return json({ watches: [] });
    if (url.pathname === "/api/alerts/inbox") return json({ alerts: [], unreadCount: 0 });
    if (url.pathname === "/api/expenses") return json({ expenses: [] });
    if (url.pathname === "/api/system/status") return json({ sources: [], summary: { livePrimaryComps: true, secondaryCrossCheck: true, alertDelivery: false, storedSales: false } });
    if (url.pathname === "/api/deal-sessions") return json({ session: null, summary: { includedCount: 0, excludedCount: 0, totalMaxCashPence: 0, totalMaxTradePence: 0, totalExpectedProceedsPence: 0, totalExpectedProfitPence: 0, suggestedBundleOfferPence: 0, completionReady: false, completionBlockers: [] } });
    if (url.pathname === "/api/comps/reviews") return json({ reviews: [], nextCursor: null });
    if (url.pathname === "/api/ebay/status") return json({ configured: false, connected: false });
    if (url.pathname === "/api/ebay/orders/sync") return json({ unmatchedPaidOrders: 0, lastSuccessAt: null });
    if (url.pathname === "/api/catalog/sets" || url.pathname === "/api/catalog/search") return json({ sets: [] });
    if (url.pathname === "/api/catalog/cards") return json({ cards: [] });
    if (/^\/api\/cards\/[^/]+\/price-history$/.test(url.pathname)) return json({ snapshots: [], comps: [], listings: [], costBasisPence: 2500, sales: [] });
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

async function shoot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => undefined);
  await page.screenshot({ path: path.join(SHOTS, name) });
}

async function pageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function hitButton(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeVisible();
  const target = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const owner = hit?.closest("button");
    return {
      label: owner?.textContent?.replace(/\s+/g, " ").trim() ?? hit?.tagName ?? "",
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
    };
  });
  return target;
}

test("scan actions stay tappable and the shutter is on screen at 390 and iPhone SE", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await page.goto("/?view=buy");
    await expect(page.getByRole("heading", { name: "Know the card. Know your ceiling." })).toBeVisible();
    const scan = await hitButton(page, "Scan a card");
    const type = await hitButton(page, "Type card details");
    expect(scan.label).toMatch(/Scan a card/);
    expect(type.label).toMatch(/Type card details/);
    expect(scan.height).toBeGreaterThanOrEqual(44);
    expect(type.height).toBeGreaterThanOrEqual(44);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await shoot(page, "buy-masthead-390x844.png");

    await page.setViewportSize({ width: 375, height: 667 });
    await page.getByRole("button", { name: "Scan a card", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Scan a card" });
    await expect(sheet).toBeVisible();
    const upload = sheet.locator(".scan-upload-button");
    await expect(upload).toBeVisible();
    const place = await upload.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    });
    expect(place.top).toBeGreaterThanOrEqual(0);
    expect(place.bottom).toBeLessThanOrEqual(667);
    expect(place.height).toBeGreaterThanOrEqual(44);
    const shutter = sheet.locator(".scan-shutter-button");
    await expect(shutter).toBeVisible();
    const shutterBox = await shutter.boundingBox();
    expect(shutterBox).not.toBeNull();
    expect(shutterBox!.y).toBeGreaterThanOrEqual(0);
    expect(shutterBox!.y + shutterBox!.height).toBeLessThanOrEqual(667);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await shoot(page, "scan-sheet-375x667.png");

    await page.locator("#scan-photo-upload").setInputFiles(path.join(process.cwd(), "public", "icon-512.png"));
    await expect(sheet.getByText("Comp ready", { exact: true })).toBeVisible({ timeout: 30_000 });
    const checks = await sheet.locator(".scan-ready-checks span").evaluateAll((nodes) => nodes.map((node) => ({
      text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
      width: node.getBoundingClientRect().width,
      clipped: node.scrollWidth > node.clientWidth + 1,
    })));
    expect(checks.map((check) => check.text)).toEqual(expect.arrayContaining([
      expect.stringMatching(/Identity/),
      expect.stringMatching(/Photo/),
      expect.stringMatching(/kept/),
    ]));
    expect(Math.min(...checks.map((check) => check.width))).toBeGreaterThanOrEqual(120);
    expect(checks.every((check) => !check.clipped)).toBe(true);
    const ready = sheet.locator(".scan-comp-ready");
    const readyBox = await ready.boundingBox();
    const actions = await sheet.locator(".scan-sheet-actions").boundingBox();
    expect(readyBox).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(readyBox!.y).toBeGreaterThanOrEqual(0);
    expect(readyBox!.y + readyBox!.height).toBeLessThanOrEqual(actions!.y + 4);
    await expect(sheet.getByText("£42.00 market comp", { exact: true })).toBeVisible();
    const setChip = sheet.locator(".scan-identity-chips span").filter({ hasText: "Lost Origin Trainer Gallery" });
    await expect(setChip).toBeVisible();
    const chip = await setChip.evaluate((node) => ({
      clipped: node.scrollHeight > node.clientHeight + 2 && getComputedStyle(node).webkitLineClamp === "none",
      text: node.textContent,
    }));
    expect(chip.text).toContain("Lost Origin Trainer Gallery");
    await shoot(page, "scan-ready-375x667.png");
  } finally {
    await context.close();
  }
});

test("Today mission title stays inside the card at 390 and on iPhone SE", async ({ browser, baseURL }) => {
  for (const [width, height, shot] of [[390, 844, "today-390x844.png"], [375, 667, "today-375x667.png"]] as const) {
    const context = await phone(browser, baseURL!, width, height);
    await mockApis(context);
    const page = await context.newPage();
    try {
      await resetStorage(page);
      await page.goto("/?view=today");
      const title = page.locator("#today-command-title");
      await expect(title).toBeVisible();
      // The border box can sit inside the card even while max-width is still
      // 14ch, because the flex item shrinks. That check passes with the phone
      // rule deleted. The rule is what replaces the 14ch cap with the card,
      // drops the 2.65rem face, and keeps the line box from clipping.
      const fit = await title.evaluate((element) => {
        const style = getComputedStyle(element);
        const copy = element.parentElement;
        if (!copy) throw new Error("Mission title has no command copy");
        const copyStyle = getComputedStyle(copy);
        const card = element.closest(".today-command");
        if (!card) throw new Error("Mission title is outside the Today card");
        const contentWidth = copy.clientWidth - parseFloat(copyStyle.paddingLeft) - parseFloat(copyStyle.paddingRight);
        const rawMax = style.maxWidth;
        const maxWidth = rawMax === "none"
          ? Number.POSITIVE_INFINITY
          : rawMax.endsWith("%")
            ? (parseFloat(rawMax) / 100) * contentWidth
            : parseFloat(rawMax);
        const zero = document.createElement("span");
        zero.textContent = "0";
        zero.style.position = "absolute";
        zero.style.visibility = "hidden";
        zero.style.whiteSpace = "pre";
        zero.style.font = style.font;
        document.body.appendChild(zero);
        const fourteenCh = zero.getBoundingClientRect().width * 14;
        zero.remove();
        const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const range = document.createRange();
        range.selectNodeContents(element);
        const lines = [...range.getClientRects()];
        const rect = element.getBoundingClientRect();
        const copyRect = copy.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const furthest = (limit: number) => Math.max(rect.right - limit, ...lines.map((line) => line.right - limit));
        return {
          text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
          maxWidth,
          contentWidth,
          fourteenCh,
          fontRem: parseFloat(style.fontSize) / rootSize,
          lineHeightRatio: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
          overflowWrap: style.overflowWrap,
          copyMaxWidth: copyStyle.maxWidth,
          paddingTop: parseFloat(copyStyle.paddingTop),
          paddingRight: parseFloat(copyStyle.paddingRight),
          paddingBottom: parseFloat(copyStyle.paddingBottom),
          paddingLeft: parseFloat(copyStyle.paddingLeft),
          pastCopy: furthest(copyRect.right),
          pastCard: furthest(cardRect.right),
          pastViewport: furthest(window.innerWidth),
        };
      });
      expect(fit.text.length).toBeGreaterThan(14);
      expect(Math.abs(fit.maxWidth - fit.contentWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(fit.maxWidth - fit.fourteenCh)).toBeGreaterThan(1);
      expect(fit.fontRem).toBeGreaterThanOrEqual(1.5);
      expect(fit.fontRem).toBeLessThanOrEqual(1.8);
      expect(fit.lineHeightRatio).toBeGreaterThanOrEqual(1);
      expect(fit.overflowWrap).toBe("anywhere");
      expect(fit.copyMaxWidth).not.toBe("none");
      expect(fit.paddingTop).toBeLessThanOrEqual(20);
      expect(fit.paddingRight).toBeLessThanOrEqual(18);
      expect(fit.paddingBottom).toBeLessThanOrEqual(16);
      expect(fit.paddingLeft).toBeLessThanOrEqual(18);
      expect(fit.pastCopy).toBeLessThanOrEqual(1);
      expect(fit.pastCard).toBeLessThanOrEqual(1);
      expect(fit.pastViewport).toBeLessThanOrEqual(1);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      const action = page.locator(".today-command-actions .primary-button");
      await expect(action).toBeVisible();
      const actionBox = await action.boundingBox();
      expect(actionBox).not.toBeNull();
      expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(height - 90);
      await shoot(page, shot);
    } finally {
      await context.close();
    }
  }
});

test("binder filters keep a Drafts peek and bring Sold fully into the row at 390", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await page.goto("/?view=stock");
    await expect(page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" })).toBeVisible({ timeout: 30_000 });
    const tabs = page.locator(".inventory-filter-tabs");
    const peek = await tabs.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const drafts = [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Drafts"));
      if (!drafts) return 0;
      const rect = drafts.getBoundingClientRect();
      return Math.max(0, Math.min(rect.right, box.right) - Math.max(rect.left, box.left));
    });
    expect(peek).toBeGreaterThanOrEqual(16);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: /^Sold/ }).click();
    await expect(page.getByRole("button", { name: /^Sold/ })).toHaveAttribute("aria-pressed", "true");
    const sold = await tabs.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const button = [...el.querySelectorAll("button")].find((node) => node.textContent?.includes("Sold"));
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { leftGap: rect.left - box.left, rightGap: box.right - rect.right };
    });
    expect(sold).not.toBeNull();
    expect(sold!.leftGap).toBeGreaterThanOrEqual(-1);
    expect(sold!.rightGap).toBeGreaterThanOrEqual(8);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await shoot(page, "binder-filters-sold-390x844.png");
  } finally {
    await context.close();
  }
});
