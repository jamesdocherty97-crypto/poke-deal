import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "playwright/test";

/**
 * Phone sell-flow regressions for the price check, draft and sticky bar.
 * Example fixture data only. External hosts are aborted.
 */

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CARD = {
  id: "card-fixture-gengar", tcgApiId: "swsh11tg-TG06", name: "Gengar", setName: "Lost Origin Trainer Gallery",
  setCode: "swsh11tg", number: "TG06/TG30", imageUrl: null, displayImageUrl: null, game: "POKEMON", language: "EN",
};
const COMP_LOOKUP_ALERT = "Couldn't check this price. Check signal and try again.";

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

function inventoryItem(withListing = false) {
  const createdAt = "2026-10-21T09:00:00.000Z";
  return {
    id: "item-fixture-gengar", card: CARD, grade: "RAW", quantity: 1, costBasis: 2500,
    acquiredFrom: "Card fair", location: "Binder", condition: "NM", graderCert: null,
    status: "IN_STOCK", createdAt, updatedAt: createdAt, sales: [], photos: [],
    listings: withListing ? [{
      id: "listing-fixture-gengar", itemId: "item-fixture-gengar", channel: "EBAY", state: "DRAFT",
      title: "Example Gengar draft", suggestedPrice: 4200, listPrice: 4200, externalRef: null, externalUrl: null,
      listedAt: null, endedAt: null, createdAt, updatedAt: createdAt,
    }] : [],
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
    baseURL, viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    serviceWorkers: "block", userAgent: IPHONE,
  });
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "127.0.0.1" || host === "localhost") return route.fallback();
    return route.abort();
  });
  return context;
}

async function mockApis(context: BrowserContext, options: { comp?: "ok" | "error" | "hold"; withListing?: boolean } = {}) {
  let releaseHold = () => {};
  const hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  let streams = 0;
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/comps/stream") {
      streams += 1;
      if (options.comp === "error") return json({ error: "Example data: comp lookup failed" }, 500);
      if (options.comp === "hold") {
        await hold;
        return json({ error: "Example data: comp lookup failed" }, 500);
      }
      const events = compEvents();
      return route.fulfill({
        status: 200, contentType: "application/x-ndjson", headers: { "Cache-Control": "no-store" },
        body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      });
    }
    if (url.pathname === "/api/inventory") return json({ items: [inventoryItem(options.withListing)] });
    if (url.pathname === "/api/listings") {
      const item = inventoryItem(options.withListing);
      return json({ listings: options.withListing ? [{ ...item.listings[0], item }] : [] });
    }
    if (url.pathname === "/api/dashboard") return json(dashboard());
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
    if (/^\/api\/cards\/[^/]+\/price-history$/.test(url.pathname)) return json({ snapshots: [], comps: [], listings: [], costBasisPence: 2500, sales: [] });
    return json({});
  });
  return {
    releaseHold,
    streamCount: () => streams,
  };
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

async function stockRow(page: Page) {
  await page.goto("/?view=stock");
  const row = page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function priceOwnedCard(page: Page) {
  const row = await stockRow(page);
  await row.getByRole("button", { name: "Price card", exact: true }).click();
  await expect(page.locator(".stock-reprice-card")).toBeVisible({ timeout: 30_000 });
  return row;
}

function parseCssColor(input: string) {
  const match = input.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`Unparsed colour ${input}`);
  const [r, g, b, a] = match[1].split(",").map((part) => Number(part.trim()));
  return { r, g, b, a: a ?? 1 };
}

function contrastRatio(foreground: string, background: string) {
  const fg = parseCssColor(foreground);
  const bg = parseCssColor(background);
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (color: { r: number; g: number; b: number }) =>
    0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

async function buttonContrast(button: Locator) {
  const colors = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, backgroundColor: style.backgroundColor };
  });
  return { ...colors, ratio: contrastRatio(colors.color, colors.backgroundColor) };
}

async function box(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height };
  });
}

function edgesLineUp(field: { left: number; right: number }, button: { left: number; right: number }) {
  expect(Math.abs(field.left - button.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(field.right - button.right)).toBeLessThanOrEqual(2);
}

async function clippedLabels(bar: Locator) {
  return bar.locator("strong, small").evaluateAll((nodes) => nodes.map((node) => ({
    text: node.textContent ?? "",
    clipped: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
  })));
}

test("Draft listing on the price check opens the form there", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await priceOwnedCard(page);
    await page.locator(".stock-reprice-card").getByRole("button", { name: "Draft listing", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Create listing", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Create listing" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a price check prefills its suggested list price", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await priceOwnedCard(page);
    await expect(page.locator(".stock-reprice-card")).toContainText("Suggested list price £42.00");
    await page.locator(".stock-reprice-card").getByRole("button", { name: "Draft listing", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create listing" });
    await expect(dialog.getByLabel(/Your list price/)).toHaveValue("42.00");
    await expect(dialog).toContainText("The suggestion is prefilled. Edit it freely before saving.");
  } finally {
    await context.close();
  }
});

test("a draft without a price check says the start price is cost plus 35 percent", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    const row = await stockRow(page);
    await row.getByRole("button", { name: "Draft listing", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create listing" });
    await expect(dialog.getByLabel(/Your list price/)).toHaveValue("33.75");
    await expect(dialog).toContainText("Starting price is what you paid plus 35%. No price check yet.");
  } finally {
    await context.close();
  }
});

test("sheet submit buttons keep a readable fill", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await priceOwnedCard(page);
    await page.locator(".stock-reprice-card").getByRole("button", { name: "Draft listing", exact: true }).click();
    const continueButton = page.getByRole("button", { name: "Continue to eBay review", exact: true });
    await expect(continueButton).toBeVisible();
    const listing = await buttonContrast(continueButton);
    expect(listing.ratio).toBeGreaterThanOrEqual(4.5);

    await page.getByRole("button", { name: "Close", exact: true }).click();
    const row = page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" }).first();
    await row.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("button", { name: /Edit stock details/ }).click();
    const save = page.getByRole("button", { name: "Save stock", exact: true });
    await expect(save).toBeVisible();
    const stock = await buttonContrast(save);
    expect(stock.ratio).toBeGreaterThanOrEqual(4.5);

    await page.keyboard.press("Escape");
    await row.getByRole("button", { name: "Sell", exact: true }).click();
    const sale = page.getByRole("button", { name: "Create sale", exact: true });
    await expect(sale).toBeVisible();
    const sold = await buttonContrast(sale);
    expect(sold.ratio).toBeGreaterThanOrEqual(4.5);
  } finally {
    await context.close();
  }
});

test("pricing a card you already own hides the buy bar", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await priceOwnedCard(page);
    await expect(page.locator(".mobile-buy-action")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add cost", exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("bottom bar labels stay whole at 390 and 430", async ({ browser, baseURL }) => {
  for (const width of [390, 430]) {
    const context = await phone(browser, baseURL!, width, width === 390 ? 844 : 932);
    await mockApis(context);
    const page = await context.newPage();
    try {
      await resetStorage(page);
      await page.goto("/?view=buy");
      await page.getByText("Exact card details", { exact: true }).click();
      await page.getByLabel("Card", { exact: true }).fill("Gengar");
      const bar = page.locator(".mobile-buy-action");
      await expect(bar).toBeVisible();
      await expect(bar).toContainText("No auto comp");
      await expect(bar).toContainText("open UK solds or add cost and quantity");
      const clipped = await clippedLabels(bar);
      expect(clipped.filter((row) => row.clipped)).toEqual([]);

      await page.getByRole("button", { name: "Comp current card" }).click();
      await expect(page.locator(".stock-reprice-card, .comp-panel").first()).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Deal tools", exact: true }).click();
      const deal = page.locator(".mobile-buy-action");
      await expect(deal).toBeVisible();
      await expect(deal.locator("strong")).toHaveText("Cost needed");
      await expect(deal.getByRole("button", { name: "Add cost", exact: true })).toBeVisible();
      await expect(deal).toContainText("enter what you paid, then confirm");
      const dealClipped = await clippedLabels(deal);
      expect(dealClipped.filter((row) => row.clipped)).toEqual([]);
      await expect(page.locator(".buy-result-action-row .verdict-buy-action")).toBeHidden();
      await expect(page.locator(".buy-result-action-row .verdict-pass-action")).toBeHidden();
      await expect(page.locator(".comp-identity-art.blank")).toContainText("No photo");
      const navBg = await page.locator(".primary-nav.bottom-nav").evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(navBg).toBe("rgb(11, 14, 24)");
    } finally {
      await context.close();
    }
  }
});

test("a failed price check shows a plain Retry and one tap starts one lookup", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  let streams = 0;
  let mode: "fail" | "ok" = "fail";
  let releaseHold = () => {};
  let hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  let gate: Promise<void> | null = null;
  await context.route("**/api/comps/stream**", async (route) => {
    streams += 1;
    if (gate) await gate;
    if (mode === "fail") {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Example data: comp lookup failed" }) });
    }
    const events = compEvents();
    return route.fulfill({
      status: 200, contentType: "application/x-ndjson",
      body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    });
  });
  const page = await context.newPage();
  try {
    await resetStorage(page);
    const row = await stockRow(page);
    await row.getByRole("button", { name: "Price card", exact: true }).click();
    const alert = page.locator(".comp-lookup-alert");
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText(COMP_LOOKUP_ALERT);
    await expect(alert).not.toContainText("Example data");
    await expect(page.locator(".toast")).toHaveCount(0);
    const baseline = streams;
    gate = hold;
    const retry = alert.getByRole("button", { name: "Retry", exact: true });
    await retry.evaluate((button) => {
      button.click();
      button.click();
    });
    await expect.poll(() => streams).toBe(baseline + 1);
    await page.waitForTimeout(300);
    expect(streams - baseline).toBe(1);
    const busy = alert.getByRole("button", { name: "Retrying…", exact: true });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    releaseHold();
    await expect(alert.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
    await expect(alert).toContainText(COMP_LOOKUP_ALERT);
    await expect(alert).not.toContainText("Example data");
    mode = "ok";
    gate = null;
    const success = page.waitForResponse((response) => response.url().includes("/api/comps/stream") && response.ok());
    await alert.getByRole("button", { name: "Retry", exact: true }).click();
    await success;
    await expect(page.locator(".comp-lookup-alert")).toHaveCount(0);
    await expect(page.locator(".stock-reprice-card")).toContainText("£42.00");
  } finally {
    releaseHold();
    await context.close();
  }
});

test("a slow price check hides the manual bar while the lookup is busy", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  const api = await mockApis(context, { comp: "hold" });
  const page = await context.newPage();
  try {
    await resetStorage(page);
    const row = await stockRow(page);
    await row.getByRole("button", { name: "Price card", exact: true }).click();
    await expect(page.getByRole("button", { name: "Comp current card" })).toHaveText("Comping…");
    await expect(page.getByText("Checking identity…")).toBeVisible();
    await expect(page.locator(".mobile-buy-action")).toHaveCount(0);
  } finally {
    api.releaseHold();
    await context.close();
  }
});

test("create listing and edit stock sheets name themselves and restore focus", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    const row = await stockRow(page);
    const draft = row.getByRole("button", { name: "Draft listing", exact: true });
    await draft.click();
    const creator = page.getByRole("dialog", { name: "Create listing" });
    await expect(creator).toHaveAttribute("aria-modal", "true");
    await expect(creator.getByLabel(/Your list price/)).toBeFocused();
    const creatorLabel = await creator.evaluate((element) => {
      const id = element.getAttribute("aria-labelledby");
      return id ? document.getElementById(id)?.textContent ?? "" : "";
    });
    expect(creatorLabel).toBe("Create listing");
    await page.keyboard.press("Escape");
    await expect(creator).toHaveCount(0);
    await expect(draft).toBeFocused();

    const more = row.getByRole("button", { name: "More actions", exact: true });
    await more.click();
    await page.getByRole("button", { name: /Edit stock details/ }).click();
    const editor = page.getByRole("dialog", { name: "Edit stock" });
    await expect(editor).toHaveAttribute("aria-modal", "true");
    await expect(editor.getByLabel(/What I paid/)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(more).toBeFocused();
  } finally {
    await context.close();
  }
});

test("stock filter tabs keep at least a 16px peek of the next tab at 390", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await stockRow(page);
    const peek = await page.locator(".inventory-filter-tabs").evaluate((el) => {
      const box = el.getBoundingClientRect();
      const drafts = [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Drafts"));
      if (!drafts) return 0;
      const rect = drafts.getBoundingClientRect();
      return Math.max(0, Math.min(rect.right, box.right) - Math.max(rect.left, box.left));
    });
    expect(peek).toBeGreaterThanOrEqual(16);
  } finally {
    await context.close();
  }
});

test("an unconnected eBay account explains that drafts still work", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context, { withListing: true });
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await page.goto("/?view=list");
    await expect(page.locator(".ebay-setup-banner")).toContainText("eBay is not connected yet. Drafts still work; publish by copy and paste.");
    await expect(page.locator(".ebay-setup-banner")).not.toContainText("env vars");
  } finally {
    await context.close();
  }
});

test("equal vault counts read as one line and the refresh row has no inner box", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  await context.route("**/api/listings**", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "Example data: listings failed" }),
  }));
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await page.goto("/?view=stock");
    const banner = page.locator(".load-banner");
    await expect(banner).toContainText("Couldn't load listings. Your stock is still shown.");
    const retry = banner.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    const retryBox = await box(retry);
    expect(retryBox.height).toBeGreaterThanOrEqual(44);
    expect(retryBox.width).toBeGreaterThanOrEqual(44);
    const row = page.locator(".inventory-workspace .item-row").first();
    await expect(row).toBeVisible();
    expect((await box(banner)).top).toBeLessThan((await box(row)).top);
    await expect(page.locator(".vault-summary-line")).toHaveText("1 card in stock");
    await expect(page.getByText("holding", { exact: true })).toHaveCount(0);
    const headingBorder = await page.locator(".vault-heading").evaluate((element) => getComputedStyle(element).borderTopWidth);
    expect(headingBorder).toBe("0px");
  } finally {
    await context.close();
  }
});

test("an owned price check leads with the list price and a full-width next card", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context);
  const page = await context.newPage();
  try {
    await resetStorage(page);
    await priceOwnedCard(page);
    const hero = page.locator(".comp-hero");
    await expect(hero).toContainText("Suggested list price");
    await expect(hero).toContainText("£42.00");
    await expect(hero).not.toContainText("Suggested maximum buy");
    await expect(page.getByRole("button", { name: "Add to stock", exact: true })).toHaveCount(0);
    await expect(page.locator(".owned-stock-status")).toContainText("In stock · Paid £25.00");
    const actions = page.locator(".buy-result-action-row");
    const draft = actions.getByRole("button", { name: "Draft listing", exact: true });
    await expect(draft).toBeVisible();
    const next = actions.getByRole("button", { name: "Next card", exact: true });
    const rowBox = await box(actions);
    const nextBox = await box(next);
    expect(Math.abs(nextBox.width - rowBox.width)).toBeLessThanOrEqual(2);
    expect(nextBox.left).toBeLessThanOrEqual((await box(draft)).left + 2);
  } finally {
    await context.close();
  }
});

test("create listing and edit stock buttons line up with the fields over a dimmed sheet", async ({ browser, baseURL }) => {
  for (const width of [390, 430]) {
    const context = await phone(browser, baseURL!, width, width === 390 ? 844 : 932);
    await mockApis(context);
    const page = await context.newPage();
    try {
      await resetStorage(page);
      await priceOwnedCard(page);
      await page.locator(".stock-reprice-card").getByRole("button", { name: "Draft listing", exact: true }).click();
      const creator = page.getByRole("dialog", { name: "Create listing" });
      const price = creator.getByLabel(/Your list price/);
      const continueButton = creator.getByRole("button", { name: "Continue to eBay review", exact: true });
      edgesLineUp(await box(price), await box(continueButton));
      const shadow = await creator.evaluate((element) => getComputedStyle(element).boxShadow);
      expect(shadow).toContain("rgba(5, 8, 15, 0.72)");
      const paddingBottom = await continueButton.evaluate((element) => getComputedStyle(element).paddingBottom);
      expect(Number.parseFloat(paddingBottom)).toBeGreaterThanOrEqual(16);

      await creator.getByRole("button", { name: "Close", exact: true }).click();
      const row = page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" }).first();
      await row.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("button", { name: /Edit stock details/ }).click();
      const editor = page.getByRole("dialog", { name: "Edit stock" });
      const cert = editor.getByLabel("Cert", { exact: true });
      const save = editor.getByRole("button", { name: "Save stock", exact: true });
      edgesLineUp(await box(cert), await box(save));
      await expect(editor).toContainText("cost basis, not the card comp or sell price.");
      await expect(editor).not.toContainText("basis\u2014not");
      const header = editor.locator(".panel-heading");
      const paid = editor.getByRole("textbox", { name: /What I paid/ });
      const headerBox = await box(header);
      const paidBox = await box(paid);
      expect(paidBox.top).toBeGreaterThanOrEqual(headerBox.top + headerBox.height - 1);
      const scrollMargin = await paid.evaluate((element) => Number.parseFloat(getComputedStyle(element).scrollMarginTop));
      expect(scrollMargin).toBeGreaterThanOrEqual(headerBox.height);
      const headerBg = await header.evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(headerBg).toBe("rgb(14, 18, 32)");
      const editorShadow = await editor.evaluate((element) => getComputedStyle(element).boxShadow);
      expect(editorShadow).toContain("rgba(5, 8, 15, 0.72)");
    } finally {
      await context.close();
    }
  }
});

test("a failed price check hides the buy bar and gives Comp the same width as Next", async ({ browser, baseURL }) => {
  const context = await phone(browser, baseURL!, 390, 844);
  await mockApis(context, { comp: "error" });
  const page = await context.newPage();
  try {
    await resetStorage(page);
    const row = await stockRow(page);
    await row.getByRole("button", { name: "Price card", exact: true }).click();
    const alert = page.locator(".comp-lookup-alert");
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText(COMP_LOOKUP_ALERT);
    await expect(page.locator(".mobile-buy-action")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open UK", exact: true })).toHaveCount(0);
    const comp = page.getByRole("button", { name: "Comp current card" });
    const next = page.locator(".quick-intake-actions .quick-next-button");
    await expect(comp).toBeVisible();
    await expect(next).toBeVisible();
    const compBox = await box(comp);
    const nextBox = await box(next);
    expect(Math.abs(compBox.width - nextBox.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(compBox.left - nextBox.left)).toBeLessThanOrEqual(2);
  } finally {
    await context.close();
  }
});
