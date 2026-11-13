import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "playwright/test";

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

async function safeArea(page: Page, insets: { top?: number; right?: number; bottom?: number; left?: number }) {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, right: 0, bottom: 0, left: 0, ...insets },
  });
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
    if (url.pathname === "/api/alerts/inbox") return json({
      unreadCount: 1,
      alerts: [{
        id: "alert-fixture-infernape",
        kind: "EBAY_SALE",
        title: "eBay sale imported: Infernape",
        message: "Twilight Masquerade #173/167 sold for £17.49. Fees and seller postage are estimated.",
        pence: 1749,
        href: null,
        delivered: true,
        readAt: null,
        createdAt: "2026-11-13T12:00:00.000Z",
      }],
    });
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

async function stubScanCamera(context: BrowserContext) {
  // Headless Chromium has no camera, so getUserMedia is treated as blocked.
  // The recovery sheet then hides the shutter and upload control this test measures.
  await context.addInitScript(() => {
    const openCamera = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const paint = canvas.getContext("2d");
      if (paint) {
        paint.fillStyle = "#222";
        paint.fillRect(0, 0, 16, 16);
      }
      if (typeof canvas.captureStream === "function") {
        const stream = canvas.captureStream(5);
        if (stream.getVideoTracks().length > 0) return stream;
      }
      return new MediaStream();
    };
    const devices = navigator.mediaDevices;
    if (devices) {
      devices.getUserMedia = openCamera;
      return;
    }
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: openCamera } });
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

async function suggestionCardGeometry(card: Locator) {
  return card.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Suggestion card is not an element");
    const name = element.querySelector(".suggestion-name");
    const set = element.querySelector(".suggestion-set");
    const actions = element.querySelector(".smart-suggestion-actions");
    const buttons = [...element.querySelectorAll(".smart-suggestion-actions button")];
    const labelOf = (node: Element) => node.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const fill = buttons.find((button) => labelOf(button) === "Fill");
    const comp = buttons.find((button) => labelOf(button) === "Comp");
    if (!name || !set || !actions || !fill || !comp) {
      throw new Error("Suggestion card is missing the name, set, or Fill/Comp row");
    }
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    };
    const style = getComputedStyle(element);
    const read = (value: string) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const rect = element.getBoundingClientRect();
    const paddingLeft = read(style.paddingLeft);
    const paddingRight = read(style.paddingRight);
    const borderLeft = read(style.borderLeftWidth);
    const borderRight = read(style.borderRightWidth);
    // The action row lives in the grid content box. The card's border box is
    // wider by its horizontal padding and borders, so a full-width row looks
    // short if those are left in the comparison.
    const contentWidth = rect.width - borderLeft - borderRight - paddingLeft - paddingRight;
    if (!(contentWidth > 0)) throw new Error(`Suggestion card content box is ${contentWidth}`);
    return {
      name: box(name),
      set: box(set),
      actions: box(actions),
      fill: box(fill),
      comp: box(comp),
      contentWidth,
      paddingLeft,
      paddingRight,
      borderLeft,
      borderRight,
      cardWidth: rect.width,
    };
  });
}

test("scan actions stay tappable and the shutter is on screen at 390 and iPhone SE", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  await stubScanCamera(context);
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

test("typed card suggestions keep the number and sit above the nav at 390 and iPhone SE", async ({ browser, baseURL }) => {
  const cards = [
    {
      game: "POKEMON", language: "EN", name: "Gengar VMAX", setName: "Lost Origin Trainer Gallery",
      setCode: "swsh11tg", number: "TG06/TG30", rarity: "Rare Secret", tcgApiId: "swsh11tg-TG06",
      sourceLabel: "Pokemon TCG", matchLabel: "name + set + number", variantLabel: "Holofoil", identityConfidence: "high",
    },
    {
      game: "POKEMON", language: "EN", name: "Gengar", setName: "Lost Origin Trainer Gallery",
      setCode: "swsh11tg", number: "TG23/TG30", rarity: "Rare Secret", tcgApiId: "swsh11tg-TG23",
      sourceLabel: "Pokemon TCG", matchLabel: "name + set", variantLabel: "Holofoil", identityConfidence: "medium",
    },
  ];
  for (const [width, height, shot] of [[390, 844, "suggestions-390x844.png"], [375, 667, "suggestions-375x667.png"]] as const) {
    const context = await phone(browser, baseURL!, width, height);
    await mockApis(context);
    await context.route("**/api/catalog/cards**", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ cards }),
    }));
    const page = await context.newPage();
    try {
      await resetStorage(page);
      await page.goto("/?view=buy");
      await page.locator("#quick-intake").fill("Gengar");
      const list = page.locator("#smart-card-suggestions");
      await expect(list).toBeVisible();
      const number = list.locator(".suggestion-number strong").first();
      await expect(number).toHaveText("#TG06/TG30");
      await expect(list.locator(".suggestion-set strong").first()).toContainText("Lost Origin Trainer Gallery");
      // The set name is still in the card when it sits in the next column.
      // It has to start at or below the name and share that left edge.
      const placed = await suggestionCardGeometry(list.locator(".smart-card-suggestion-card").first());
      expect(placed.set.top, `set top ${placed.set.top} name bottom ${placed.name.bottom}`).toBeGreaterThanOrEqual(placed.name.bottom - 1);
      expect(Math.abs(placed.set.left - placed.name.left), `set left ${placed.set.left} name left ${placed.name.left}`).toBeLessThanOrEqual(2);
      // Fill and Comp can both be 44px and hittable while stacked, or while
      // the row only covers the text column. Their tops match, and the row
      // covers the card content box with padding and border removed.
      const actionTopDelta = Math.abs(placed.fill.top - placed.comp.top);
      expect(actionTopDelta, `Fill top ${placed.fill.top} Comp top ${placed.comp.top}`).toBeLessThanOrEqual(2);
      expect(
        placed.actions.width,
        `actions ${placed.actions.width} content ${placed.contentWidth} card ${placed.cardWidth} padding ${placed.paddingLeft}+${placed.paddingRight} border ${placed.borderLeft}+${placed.borderRight}`,
      ).toBeGreaterThanOrEqual(placed.contentWidth - 2);
      const clipped = await number.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
      expect(clipped).toBe(false);

      const navTop = await page.locator(".primary-nav.bottom-nav").evaluate((element) => element.getBoundingClientRect().top);
      const inputBox = await page.locator("#quick-intake").boundingBox();
      expect(inputBox).not.toBeNull();
      expect(inputBox!.y).toBeGreaterThanOrEqual(64);
      expect(inputBox!.y + inputBox!.height).toBeLessThan(navTop);

      for (const label of ["Fill", "Comp"]) {
        const button = list.getByRole("button", { name: label, exact: true }).first();
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(navTop - 4);
        const hit = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const node = document.elementFromPoint(x, y);
          return {
            label: node?.closest("button")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
            tag: node?.tagName ?? "",
            cls: String(node?.className ?? "").slice(0, 80),
            x: Math.round(x),
            y: Math.round(y),
          };
        });
        expect(hit.label, JSON.stringify(hit)).toBe(label);
      }

      const listBottom = await list.evaluate((element) => element.getBoundingClientRect().bottom);
      expect(listBottom).toBeLessThanOrEqual(navTop);
      const peek = await list.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const next = element.querySelectorAll(".suggestion-row")[1];
        if (!next) return 0;
        const rect = next.getBoundingClientRect();
        return Math.max(0, Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top));
      });
      expect(peek).toBeGreaterThanOrEqual(16);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
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

test("Today scrolls clear of the dock and the sticky header covers the top at 390", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await page.goto("/?view=today");
    await expect(page.locator(".today-workspace")).toBeVisible();
    await expect(page.locator("#today-command-title")).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => undefined);
    const scrolled = await page.evaluate(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, maxScroll);
      return maxScroll;
    });
    expect(scrolled).toBeGreaterThan(80);

    const geometry = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".dealer-deck.topbar");
      const nav = document.querySelector<HTMLElement>(".primary-nav.bottom-nav");
      const today = document.querySelector<HTMLElement>(".today-workspace");
      const shell = document.querySelector<HTMLElement>(".app-shell");
      if (!header || !nav || !today || !shell) throw new Error("Today shell, header, or dock is missing");

      const headerRect = header.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const todayRect = today.getBoundingClientRect();
      const headerStyle = getComputedStyle(header);
      const safeProbe = document.createElement("div");
      safeProbe.style.paddingBottom = "env(safe-area-inset-bottom)";
      safeProbe.style.minHeight = "env(safe-area-inset-top)";
      document.body.append(safeProbe);
      const safeStyle = getComputedStyle(safeProbe);
      const safeBottom = Number.parseFloat(safeStyle.paddingBottom) || 0;
      const safeTop = Number.parseFloat(safeStyle.minHeight) || 0;
      safeProbe.remove();
      let headerRule = "";
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        const walk = (list: CSSRuleList) => {
          for (const rule of list) {
            if (rule instanceof CSSStyleRule && rule.selectorText === ":root" && rule.style.getPropertyValue("--sticky-header-block")) {
              headerRule = rule.style.getPropertyValue("--sticky-header-block");
            }
            if (rule instanceof CSSGroupingRule) walk(rule.cssRules);
          }
        };
        walk(rules);
      }

      const opaque = (color: string) => {
        const slash = color.match(/\/\s*([0-9.]+)\s*\)/);
        if (slash) return Number(slash[1]) >= 0.99;
        const channels = color.match(/rgba?\(([^)]+)\)/i);
        if (!channels) return false;
        const parts = channels[1].split(/[,\s/]+/).filter(Boolean);
        return parts.length < 4 || Number(parts[3]) >= 0.99;
      };

      const leaks: Array<{ x: number; y: number; name: string }> = [];
      const gapBottom = Math.max(0, headerRect.top);
      for (let y = 0; y < gapBottom; y += 1) {
        for (let x = 0; x < window.innerWidth; x += 8) {
          const hit = document.elementFromPoint(x, y);
          if (hit !== header && !header.contains(hit)) {
            leaks.push({ x, y, name: String(hit?.className || hit?.tagName || "none").slice(0, 80) });
          }
        }
      }
      for (let x = 0; x < window.innerWidth; x += 8) {
        const hit = document.elementFromPoint(x, 1);
        if (hit !== header && !header.contains(hit)) {
          leaks.push({ x, y: 1, name: String(hit?.className || hit?.tagName || "none").slice(0, 80) });
        }
      }

      const buttons = [...today.querySelectorAll("button")].flatMap((button) => {
        const style = getComputedStyle(button);
        if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") return [];
        const rect = button.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2 || rect.bottom > todayRect.bottom + 1) return [];
        return [rect.bottom];
      });
      const lastButtonBottom = buttons.length > 0 ? Math.max(...buttons) : todayRect.bottom;

      return {
        headerTop: headerRect.top,
        headerHeight: headerRect.height,
        headerLeft: headerRect.left,
        headerRight: headerRect.right,
        scrollPad: Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0,
        safeTop,
        headerRule,
        headerBackground: headerStyle.backgroundColor,
        headerBackdrop: headerStyle.backdropFilter,
        headerOpaque: opaque(headerStyle.backgroundColor),
        leaks: leaks.slice(0, 6),
        leakCount: leaks.length,
        todayBottom: todayRect.bottom,
        lastButtonBottom,
        navTop: navRect.top,
        navHeight: navRect.height,
        shellPaddingBottom: Number.parseFloat(getComputedStyle(shell).paddingBottom) || 0,
        safeBottom,
        viewportWidth: window.innerWidth,
      };
    });

    expect(geometry.leakCount, `content above the sticky header: ${JSON.stringify(geometry.leaks)}`).toBe(0);
    expect(geometry.headerTop).toBeLessThanOrEqual(0);
    expect(geometry.headerLeft).toBeLessThanOrEqual(0);
    expect(geometry.headerRight).toBeGreaterThanOrEqual(geometry.viewportWidth);
    expect(geometry.headerOpaque, geometry.headerBackground).toBe(true);
    expect(geometry.headerBackdrop).toBe("none");
    expect(geometry.todayBottom).toBeLessThanOrEqual(geometry.navTop);
    const dockGap = geometry.navTop - geometry.todayBottom;
    expect(dockGap, `dock gap ${dockGap}px`).toBeGreaterThanOrEqual(27);
    expect(dockGap, `dock gap ${dockGap}px`).toBeLessThanOrEqual(29);
    expect(geometry.lastButtonBottom).toBeLessThanOrEqual(geometry.navTop);
    expect(geometry.shellPaddingBottom).toBeGreaterThanOrEqual(geometry.navHeight + geometry.safeBottom + 28 - 0.5);
    expect(geometry.shellPaddingBottom).toBeLessThanOrEqual(geometry.navHeight + geometry.safeBottom + 28 + 0.5);
    expect(geometry.scrollPad).toBeGreaterThanOrEqual(geometry.headerHeight - 0.5);
    expect(geometry.scrollPad - geometry.headerHeight).toBeLessThanOrEqual(1);
    expect(geometry.headerRule).toContain("safe-area-inset-top");

    const markRead = page.getByRole("button", { name: "Mark read" });
    await expect(markRead).toBeVisible();
    const markBox = await markRead.boundingBox();
    expect(markBox).not.toBeNull();
    expect(markBox!.y + markBox!.height).toBeLessThanOrEqual(geometry.navTop);
    const markHit = await markRead.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === element || element.contains(hit);
    });
    expect(markHit).toBe(true);
    await markRead.click({ trial: true });

    await page.getByRole("button", { name: "Stock", exact: true }).click();
    await expect(page.locator(".inventory-workspace")).toBeVisible();
    const shared = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".app-shell");
      const nav = document.querySelector<HTMLElement>(".primary-nav.bottom-nav");
      const stock = document.querySelector<HTMLElement>(".inventory-workspace");
      if (!shell || !nav || !stock) throw new Error("Stock shell or dock is missing");
      window.scrollTo(0, document.documentElement.scrollHeight);
      return {
        paddingBottom: getComputedStyle(shell).paddingBottom,
        stockBottom: stock.getBoundingClientRect().bottom,
        navTop: nav.getBoundingClientRect().top,
      };
    });
    expect(Number.parseFloat(shared.paddingBottom)).toBe(geometry.shellPaddingBottom);
    expect(shared.stockBottom).toBeLessThanOrEqual(shared.navTop);
  } finally {
    await context.close();
  }
});

test("phone landscape header is flush and opaque at 844x390", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 844, 390);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await page.goto("/?view=today");
    await expect(page.locator("#today-command-title")).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => undefined);
    const scrolled = await page.evaluate(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.max(maxScroll, 120));
      return maxScroll;
    });
    expect(scrolled).toBeGreaterThan(40);
    const geometry = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".dealer-deck.topbar");
      if (!header) throw new Error("Sticky header is missing");
      const rect = header.getBoundingClientRect();
      const style = getComputedStyle(header);
      const opaque = (color: string) => {
        const slash = color.match(/\/\s*([0-9.]+)\s*\)/);
        if (slash) return Number(slash[1]) >= 0.99;
        const channels = color.match(/rgba?\(([^)]+)\)/i);
        if (!channels) return false;
        const parts = channels[1].split(/[,\s/]+/).filter(Boolean);
        return parts.length < 4 || Number(parts[3]) >= 0.99;
      };
      const leaks: string[] = [];
      for (let x = 0; x < window.innerWidth; x += 12) {
        const hit = document.elementFromPoint(x, 1);
        if (hit !== header && !header.contains(hit)) leaks.push(String(hit?.className || hit?.tagName || "none").slice(0, 60));
      }
      return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        height: rect.height,
        scrollPad: Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0,
        opaque: opaque(style.backgroundColor),
        background: style.backgroundColor,
        backdrop: style.backdropFilter,
        leaks: leaks.slice(0, 4),
        leakCount: leaks.length,
        width: window.innerWidth,
      };
    });
    expect(geometry.leakCount, JSON.stringify(geometry.leaks)).toBe(0);
    expect(geometry.top).toBeLessThanOrEqual(0);
    expect(geometry.left).toBeLessThanOrEqual(0);
    expect(geometry.right).toBeGreaterThanOrEqual(geometry.width);
    expect(geometry.opaque, geometry.background).toBe(true);
    expect(geometry.backdrop).toBe("none");
    expect(geometry.scrollPad).toBeGreaterThanOrEqual(geometry.height - 0.5);
    expect(geometry.scrollPad - geometry.height).toBeLessThanOrEqual(1);

    const notched = await context.newPage();
    await safeArea(notched, { top: 47 });
    await notched.goto("/?view=today");
    await expect(notched.locator("#today-command-title")).toBeVisible();
    await notched.evaluate(() => window.scrollTo(0, 80));
    const padded = await notched.evaluate(() => {
      const header = document.querySelector(".dealer-deck.topbar");
      if (!header) throw new Error("Sticky header is missing");
      const height = header.getBoundingClientRect().height;
      const scrollPad = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      return { height, scrollPad, extra: scrollPad - height };
    });
    expect(Math.abs(padded.scrollPad - padded.height)).toBeLessThanOrEqual(1);
    expect(padded.extra).toBeLessThan(20);
    await notched.close();
  } finally {
    await context.close();
  }
});

test("a 47px top notch keeps the header flush and scroll padding equal to the header", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  const page = await context.newPage();
  await safeArea(page, { top: 47 });
  await mockApis(context);
  try {
    await resetStorage(page);
    await page.goto("/?view=today");
    await expect(page.locator("#today-command-title")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 160));
    const notch = 47;
    const geometry = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".dealer-deck.topbar");
      const mark = document.querySelector<HTMLElement>(".dealer-brand .app-mark");
      if (!header || !mark) throw new Error("Sticky header is missing");
      const headerBox = header.getBoundingClientRect();
      const markBox = mark.getBoundingClientRect();
      return {
        top: headerBox.top,
        height: headerBox.height,
        paddingTop: Number.parseFloat(getComputedStyle(header).paddingTop) || 0,
        markTop: markBox.top,
        scrollPad: Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0,
      };
    });
    expect(geometry.top).toBeLessThanOrEqual(0);
    expect(geometry.paddingTop).toBeGreaterThanOrEqual(notch);
    expect(geometry.markTop).toBeGreaterThanOrEqual(notch);
    expect(Math.abs(geometry.scrollPad - geometry.height)).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});

test("landscape side insets keep the header, dock, and page gutter clear of the notch", async ({ browser, baseURL }) => {
  const left = 47;
  const right = 34;
  for (const [width, height] of [[780, 400], [844, 390]] as const) {
    const context = await phone(browser, baseURL!, width, height);
    const page = await context.newPage();
    await safeArea(page, { left, right });
    await mockApis(context);
    try {
      await resetStorage(page);
      await page.goto("/?view=today");
      await expect(page.locator("#today-command-title")).toBeVisible();
      const cleared = await page.evaluate(({ left, right, width }) => {
        const header = document.querySelector<HTMLElement>(".dealer-deck.topbar");
        const mark = document.querySelector<HTMLElement>(".dealer-brand .app-mark");
        const today = document.querySelector<HTMLElement>(".today-workspace");
        const nav = document.querySelector<HTMLElement>(".primary-nav.bottom-nav");
        const refresh = document.querySelector<HTMLElement>(".utility-nav .icon-button");
        if (!header || !mark || !today || !nav || !refresh) throw new Error("Landscape shell is missing a notch target");
        const box = (element: HTMLElement) => element.getBoundingClientRect();
        return {
          headerLeft: box(header).left,
          headerRight: box(header).right,
          markLeft: box(mark).left,
          refreshRight: box(refresh).right,
          todayLeft: box(today).left,
          todayRight: box(today).right,
          navLeft: box(nav).left,
          navRight: box(nav).right,
          limit: width - right,
        };
      }, { left, right, width });
      expect(cleared.headerLeft, `${width}x${height}`).toBeLessThanOrEqual(0);
      expect(cleared.headerRight, `${width}x${height}`).toBeGreaterThanOrEqual(width - 1);
      expect(cleared.markLeft, `${width}x${height}`).toBeGreaterThanOrEqual(left);
      expect(cleared.refreshRight, `${width}x${height}`).toBeLessThanOrEqual(width - right + 0.5);
      expect(cleared.todayLeft, `${width}x${height}`).toBeGreaterThanOrEqual(left);
      expect(cleared.todayRight, `${width}x${height}`).toBeLessThanOrEqual(width - right + 0.5);
      expect(cleared.navLeft, `${width}x${height}`).toBeGreaterThanOrEqual(left);
      expect(cleared.navRight, `${width}x${height}`).toBeLessThanOrEqual(cleared.limit + 0.5);
    } finally {
      await context.close();
    }
  }
});

test("focusing a partly visible control clears the landscape header at 844x390", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 844, 390);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await page.goto("/?view=today");
    await expect(page.getByRole("button", { name: "Prepare stock", exact: true })).toBeVisible();
    const gap = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const button = [...document.querySelectorAll("main button")].find((element) => element.textContent?.replace(/\s+/g, " ").trim() === "Prepare stock");
      const header = document.querySelector(".dealer-deck.topbar");
      if (!button || !header) throw new Error("Prepare stock is not in the landscape view");
      button.focus();
      return button.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(-1);
  } finally {
    await context.close();
  }
});
