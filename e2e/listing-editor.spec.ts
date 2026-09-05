import { expect, test, type BrowserContext, type Locator, type Page } from "playwright/test";

test.use({ viewport: { width: 440, height: 956 }, serviceWorkers: "block" });

const TITLE = "Gengar TG06/TG30 Lost Origin Trainer Gallery Pokemon Card RAW NM";
const DESCRIPTION = "Actual card pictured. Near mint, kept sleeved in Binder A.";
const UPDATED_TITLE = "Gengar TG06/TG30 Lost Origin Pokemon Card RAW NM - Actual Photos";
const UPDATED_DESCRIPTION = "Actual card pictured front and back. Near mint. Ships sleeved and protected.";

test("a deep queue opens a modal immediately, traps focus and returns to the same control", async ({ page, context }) => {
  const fixture = await installFixture(context, page, { deepQueue: true });
  let release!: () => void;
  fixture.readGate = new Promise<void>((resolve) => { release = resolve; });
  const { dialog, trigger } = await openEditor(page, fixture);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1500);
  await expect(dialog).toHaveJSProperty("open", true);
  expect(await dialog.evaluate((node) => node.matches(":modal"))).toBe(true);
  await expect(dialog.getByRole("status")).toContainText("Loading current eBay listing");
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Edit listing", exact: true })).toBeFocused();
  release();
  await expect(dialog.getByRole("textbox", { name: "Your list price (£)", exact: true })).toHaveValue("45.00");
  await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(DESCRIPTION);
  expect(fixture.listing.description).toBeNull();
  await expect(dialog).toContainText("£67.00");
  expect(fixture.patches).toEqual([]);
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Tab");
    await expectModalFocus(dialog);
  }
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Shift+Tab");
    await expectModalFocus(dialog);
  }
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(fixture.patches).toEqual([]);
  assertClean(fixture);
});

test("a failed live read cannot expose blank editing and can be retried safely", async ({ page, context }) => {
  const fixture = await installFixture(context, page);
  fixture.failReads = true;
  const { dialog } = await openEditor(page, fixture);
  await expect(dialog.getByRole("alert")).toContainText("Current eBay details could not be read.");
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  expect(fixture.patches).toEqual([]);
  const failedReads = fixture.reads;
  fixture.failReads = false;
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(DESCRIPTION);
  await expect(dialog.getByRole("textbox", { name: "Listing title", exact: true })).toHaveValue(TITLE);
  await expect(dialog.getByRole("textbox", { name: "Your list price (£)", exact: true })).toHaveValue("45.00");
  expect(fixture.reads).toBe(failedReads + 1);
  expect(fixture.patches).toEqual([]);
  assertClean(fixture);
});

test("live save sends only the chosen title, description and price and waits for confirmation", async ({ page, context }) => {
  const fixture = await installFixture(context, page);
  let release!: () => void;
  fixture.patchGate = new Promise<void>((resolve) => { release = resolve; });
  const { dialog } = await openEditor(page, fixture);
  await dialog.getByRole("textbox", { name: "Listing title", exact: true }).fill(UPDATED_TITLE);
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill(UPDATED_DESCRIPTION);
  await dialog.getByRole("textbox", { name: "Your list price (£)", exact: true }).fill("42.75");
  await expect(dialog).toContainText("£45.00");
  await expect(dialog).toContainText("£42.75");
  const save = dialog.getByRole("button", { name: "Update live eBay listing", exact: true });
  await save.click();
  await expect.poll(() => fixture.patches.length).toBe(1);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
  expect(fixture.patches[0]).toEqual({ title: UPDATED_TITLE, titleCustomized: true, description: UPDATED_DESCRIPTION, listPricePence: 4275 });
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/deal-sessions" && response.request().method() === "GET").then((response) => response.finished());
  release();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Live eBay listing updated.", { exact: true })).toBeVisible();
  await refreshed;
  await page.reload();
  const reopened = await openEditor(page, fixture, false);
  await expect(reopened.dialog.getByRole("textbox", { name: "Listing title", exact: true })).toHaveValue(UPDATED_TITLE);
  await expect(reopened.dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(UPDATED_DESCRIPTION);
  await expect(reopened.dialog.getByRole("textbox", { name: "Your list price (£)", exact: true })).toHaveValue("42.75");
  expect(fixture.listing.suggestedPrice).toBe(6700);
  assertClean(fixture);
});

test("a provider failure keeps the edit visible and retries the same changed field only", async ({ page, context }, testInfo) => {
  const fixture = await installFixture(context, page);
  fixture.replies = ["failure", "confirmed"];
  const { dialog } = await openEditor(page, fixture);
  await dialog.getByRole("textbox", { name: "Listing title", exact: true }).fill(UPDATED_TITLE);
  await dialog.getByRole("button", { name: "Update live eBay listing", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("eBay is temporarily unavailable. Your saved listing has not changed.");
  await expect(dialog.getByRole("textbox", { name: "Listing title", exact: true })).toHaveValue(UPDATED_TITLE);
  await expect(dialog.getByRole("textbox", { name: "Your list price (£)", exact: true })).toHaveValue("45.00");
  await expect(dialog.getByRole("button", { name: "Update live eBay listing", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("link", { name: "Check live listing on eBay", exact: true })).toHaveAttribute("href", fixture.listing.externalUrl!);
  await page.screenshot({ path: testInfo.outputPath("listing-save-error-440.png"), fullPage: false });
  await expect(page.getByText("Live eBay listing updated.", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Update live eBay listing", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(fixture.patches).toEqual([{ title: UPDATED_TITLE, titleCustomized: true }, { title: UPDATED_TITLE, titleCustomized: true }]);
  assertClean(fixture);
});

test("a live description cannot be cleared into an unseen generated replacement", async ({ page, context }) => {
  const fixture = await installFixture(context, page);
  const { dialog } = await openEditor(page, fixture);
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("");
  await expect(dialog).toContainText("Add a description so you can review exactly what buyers will see.");
  await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("button", { name: "Update live eBay listing", exact: true })).toBeDisabled();
  expect(fixture.patches).toEqual([]);
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill(UPDATED_DESCRIPTION);
  await dialog.getByRole("button", { name: "Update live eBay listing", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(fixture.patches).toEqual([{ description: UPDATED_DESCRIPTION }]);
  assertClean(fixture);
});

test("remote whitespace does not make untouched copy dirty or enter a price-only update", async ({ page, context }) => {
  const fixture = await installFixture(context, page);
  fixture.liveDetails.title = `${TITLE} `;
  fixture.liveDetails.description = `${DESCRIPTION}\n`;
  const { dialog } = await openEditor(page, fixture);
  await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(`${DESCRIPTION}\n`);
  await expect(dialog.getByRole("textbox", { name: "Listing title", exact: true })).toHaveValue(`${TITLE} `);
  await expect(dialog.getByRole("button", { name: "Update live eBay listing", exact: true })).toBeDisabled();
  await expect(dialog).toContainText("No changes yet");
  await dialog.getByRole("textbox", { name: "Your list price (£)", exact: true }).fill("47.25");
  await dialog.getByRole("button", { name: "Update live eBay listing", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(fixture.patches).toEqual([{ listPricePence: 4725 }]);
  expect(fixture.liveDetails.title).toBe(`${TITLE} `);
  expect(fixture.liveDetails.description).toBe(`${DESCRIPTION}\n`);
  assertClean(fixture);
});

test("HTTP success without a confirmed live update does not dismiss the dealer's edits", async ({ page, context }) => {
  const fixture = await installFixture(context, page);
  fixture.replies = ["unconfirmed", "confirmed"];
  const { dialog } = await openEditor(page, fixture);
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill(UPDATED_DESCRIPTION);
  await dialog.getByRole("button", { name: "Update live eBay listing", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(UPDATED_DESCRIPTION);
  await expect(page.getByText("Live eBay listing updated.", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Update live eBay listing", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(fixture.patches).toEqual([{ description: UPDATED_DESCRIPTION }, { description: UPDATED_DESCRIPTION }]);
  assertClean(fixture);
});

test("dirty close offers stay or discard without accidentally saving", async ({ page, context }) => {
  const fixture = await installFixture(context, page);
  const { dialog, trigger } = await openEditor(page, fixture);
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill(UPDATED_DESCRIPTION);
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("button", { name: "Keep editing", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(UPDATED_DESCRIPTION);
  await dialog.getByRole("button", { name: "Close listing editor", exact: true }).click();
  await dialog.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Edit listing", exact: true }).getByRole("textbox", { name: "Description", exact: true })).toHaveValue(DESCRIPTION);
  expect(fixture.patches).toEqual([]);
  assertClean(fixture);
});

test("a manually tracked live eBay listing gives a truthful marketplace fallback", async ({ page, context }) => {
  const fixture = await installFixture(context, page, { manuallyTracked: true });
  const { dialog } = await openEditor(page, fixture);
  await expect(dialog).toContainText("This listing needs editing on eBay");
  await expect(dialog.getByRole("link", { name: "Open listing on eBay", exact: true })).toHaveAttribute("href", fixture.listing.externalUrl!);
  await expect(dialog.getByRole("button", { name: "Update live eBay listing", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Save listing", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect(fixture.patches).toEqual([]);
  assertClean(fixture);
});

test("editing a draft does not activate it or adopt a suggested price", async ({ page, context }) => {
  const fixture = await installFixture(context, page, { draft: true });
  const { dialog } = await openEditor(page, fixture);
  await dialog.getByText("Channel & listing link", { exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Channel", exact: true })).toHaveValue("EBAY");
  await expect(dialog.getByRole("textbox", { name: "Listing URL", exact: true })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: "Your list price (£)", exact: true })).toHaveValue("45.00");
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill(UPDATED_DESCRIPTION);
  await dialog.getByRole("button", { name: "Save listing", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Listing saved.", { exact: true })).toBeVisible();
  expect(fixture.patches).toEqual([{ description: UPDATED_DESCRIPTION }]);
  expect(fixture.listing.state).toBe("DRAFT");
  expect(fixture.listing.listPrice).toBe(4500);
  expect(fixture.listing.externalUrl).toBeNull();
  assertClean(fixture);
});

test("the editor reflows at 320px, phone size, zoom equivalence and desktop with usable controls", async ({ page, context }, testInfo) => {
  const fixture = await installFixture(context, page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?view=list");
  const firstEdit = page.getByRole("button", { name: "Edit live listing", exact: true });
  await expect(firstEdit).toBeInViewport();
  const firstEditBounds = await firstEdit.boundingBox();
  const navigationBounds = await page.getByRole("navigation", { name: "Primary", exact: true }).boundingBox();
  expect(firstEditBounds!.y + firstEditBounds!.height, "First listing can be edited above the phone navigation").toBeLessThanOrEqual(navigationBounds!.y);
  await page.screenshot({ path: testInfo.outputPath("listing-queue-440.png"), fullPage: false });
  const { dialog } = await openEditor(page, fixture, false);
  await expect(dialog.getByRole("textbox", { name: "Your list price (£)", exact: true })).toHaveValue("45.00");
  for (const viewport of [{ width: 320, height: 800 }, { width: 440, height: 956 }, { width: 640, height: 480 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect.poll(async () => {
      const box = await dialog.boundingBox();
      return Boolean(box && box.y + box.height <= viewport.height + 1);
    }).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.y).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    for (const name of ["Close listing editor", "Cancel", "Update live eBay listing"]) {
      const control = dialog.getByRole("button", { name, exact: true });
      const box = await control.boundingBox();
      expect(box!.height, `${name} height at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `${name} width at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
      expect(box!.y + box!.height, `${name} remains onscreen at ${viewport.width}px`).toBeLessThanOrEqual(viewport.height + 1);
    }
    await page.screenshot({ path: testInfo.outputPath(`listing-editor-${viewport.width}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 440, height: 956 });
  await dialog.getByRole("textbox", { name: "Description", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("listing-description-440.png"), fullPage: false });
  await dialog.getByText("Stock, condition & photos", { exact: true }).click();
  await expect(dialog).toContainText("Saved stock and photos are not a live eBay quantity or photo check.");
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  assertClean(fixture);
});

async function expectModalFocus(dialog: Locator) {
  // Native dialogs may let Tab reach browser chrome; no background app control
  // may receive focus. Browsers represent chrome focus as an unfocused BODY.
  const focus = await dialog.evaluate((node) => ({ within: node.contains(document.activeElement), tag: document.activeElement?.tagName, documentFocused: document.hasFocus() }));
  expect(focus.within || (focus.tag === "BODY" && !focus.documentFocused), JSON.stringify(focus)).toBe(true);
}

async function openEditor(page: Page, fixture: EditorFixture, navigate = true): Promise<{ dialog: Locator; trigger: Locator }> {
  if (navigate) await page.goto("/?view=list");
  await page.locator('select[name="listing-state"]').selectOption(fixture.listing.state);
  const row = page.locator(".market-list .item-row").filter({ has: page.getByRole("heading", { name: fixture.listing.title, exact: true }) });
  await expect(row).toBeVisible();
  const trigger = row.getByRole("button", { name: fixture.listing.state === "ACTIVE" ? "Edit live listing" : "Edit price", exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Edit listing", exact: true });
  await expect(dialog).toBeVisible();
  return { dialog, trigger };
}

type Patch = Record<string, unknown>;
type Options = { draft?: boolean; manuallyTracked?: boolean; deepQueue?: boolean };

class EditorFixture {
  readonly now = new Date().toISOString();
  readonly patches: Patch[] = [];
  readonly unexpected: string[] = [];
  readonly pageErrors: string[] = [];
  readonly expectedFailures = new Set<string>();
  replies: Array<"failure" | "unconfirmed" | "confirmed"> = [];
  failReads = false;
  reads = 0;
  readGate: Promise<void> | null = null;
  patchGate: Promise<void> | null = null;
  liveDetails = { title: TITLE, description: DESCRIPTION, listPricePence: 4500 };
  readonly listing: ReturnType<EditorFixture["makeListing"]>;
  readonly rows: Array<ReturnType<EditorFixture["makeListing"]>>;

  constructor(options: Options) {
    this.listing = this.makeListing("gengar", "Gengar", TITLE, options);
    const queueNames = ["Bulbasaur", "Ivysaur", "Venusaur", "Charmander", "Charmeleon", "Charizard", "Squirtle", "Wartortle", "Blastoise", "Caterpie", "Metapod", "Butterfree"];
    this.rows = [...(options.deepQueue ? queueNames.map((name, index) => this.makeListing(`queue-${index}`, name, `${name} Base Set Pokemon Card RAW NM`, options)) : []), this.listing];
  }

  makeListing(id: string, name: string, title: string, options: Options) {
    const active = !options.draft;
    return {
      id: `listing-${id}`, itemId: `item-${id}`, channel: "EBAY", state: active ? "ACTIVE" : "DRAFT", title,
      description: active ? null : DESCRIPTION, titleCustomized: false, listPrice: 4500, suggestedPrice: 6700,
      externalRef: active ? "123456789012" : null, externalUrl: active ? "https://www.ebay.co.uk/itm/123456789012" : null,
      ebayOfferId: options.manuallyTracked ? null : `offer-${id}`, listedAt: active ? this.now : null, endedAt: null,
      createdAt: this.now, updatedAt: this.now,
      item: { id: `item-${id}`, card: { id: `card-${id}`, name, setName: "Lost Origin Trainer Gallery", number: "TG06/TG30", game: "POKEMON", language: "EN", imageUrl: null, displayImageUrl: null }, grade: "RAW", condition: "NM", quantity: 1, costBasis: 2500, status: "IN_STOCK", acquiredAt: this.now, acquiredFrom: "Card show", location: "Binder A", graderCert: null, createdAt: this.now, updatedAt: this.now, photos: [{ id: `photo-${id}`, url: "/icon-512.png", origin: "REAL", role: "FRONT", order: 0, width: 512, height: 512 }], sales: [] },
    };
  }

  inventory() { return this.rows.map((listing) => ({ ...listing.item, listings: [{ ...listing, item: undefined }] })); }

  dashboard() {
    return { metrics: { stockCount: this.rows.length, listedCount: this.listing.state === "ACTIVE" ? this.rows.length : 0, soldCount: 0, reservedCount: 0, activeCostPence: 2500 * this.rows.length, soldCostPence: 0, realizedRevenuePence: 0, realizedFeesPence: 0, realizedPostagePence: 0, realizedProfitPence: 0, operatingExpensePence: 0, netProfitPence: 0, cashInPence: 0, cashOutPence: 2500 * this.rows.length, cashNetPence: -2500 * this.rows.length, cashRecoveryPct: 0, realizedMarginPct: null, sellThroughPct: 0, averageAgeDays: 0, agedStockCount: 0, channelBreakdown: [], bestSale: null, worstSale: null, provisionalSaleCount: 0 }, listingsByState: { DRAFT: this.listing.state === "DRAFT" ? this.rows.length : 0, ACTIVE: this.listing.state === "ACTIVE" ? this.rows.length : 0, SOLD: 0, ENDED: 0 }, recentSales: [], salesToReconcile: [], salesToReconcileCount: 0, recentExpenses: [], monthlyPnl: [], staleStock: [] };
  }
}

async function installFixture(context: BrowserContext, page: Page, options: Options = {}) {
  const fixture = new EditorFixture(options);
  page.on("pageerror", (error) => fixture.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) fixture.pageErrors.push(message.text());
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && !fixture.expectedFailures.has(`${path}:${response.status()}`)) fixture.unexpected.push(`HTTP ${response.status()} ${path}`);
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      fixture.unexpected.push(`Blocked external request: ${url.origin}${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === `/api/listings/${fixture.listing.id}/ebay/edit` && method === "GET") {
      fixture.reads++;
      if (fixture.readGate) await fixture.readGate;
      if (fixture.failReads) { fixture.expectedFailures.add(`${path}:503`); return json({ error: "Current eBay details could not be read." }, 503); }
      return json(fixture.liveDetails);
    }
    if (path === `/api/listings/${fixture.listing.id}` && method === "PATCH") {
      const body = request.postDataJSON() as Patch;
      fixture.patches.push(body);
      if (fixture.patchGate) await fixture.patchGate;
      const reply = fixture.replies.shift() ?? "confirmed";
      if (reply === "failure") { fixture.expectedFailures.add(`${path}:503`); return json({ error: "eBay is temporarily unavailable. Your saved listing has not changed." }, 503); }
      if (reply === "unconfirmed") return json({ listing: fixture.listing });
      for (const [key, value] of Object.entries(body)) {
        if (key === "listPricePence") fixture.listing.listPrice = Number(value);
        else Object.assign(fixture.listing, { [key]: value });
        if (["title", "description", "listPricePence"].includes(key)) Object.assign(fixture.liveDetails, { [key]: value });
      }
      return json({ listing: fixture.listing, ...(fixture.listing.state === "ACTIVE" ? { remoteUpdate: { status: "confirmed", fields: Object.keys(body) } } : {}) });
    }
    if (method !== "GET") {
      fixture.unexpected.push(`${method} ${path}`);
      return json({ error: "Unexpected fixture mutation" }, 500);
    }
    if (path === "/api/inventory") return json({ items: fixture.inventory() });
    if (path === "/api/listings") return json({ listings: fixture.rows });
    if (path === "/api/dashboard") return json(fixture.dashboard());
    if (path === "/api/snapshots/portfolio") return json({ points: [], latest: null, previous: null, changePence: null, changePct: null });
    if (path === "/api/watches") return json({ watches: [] });
    if (path === "/api/alerts/inbox") return json({ alerts: [], unreadCount: 0 });
    if (path === "/api/expenses") return json({ expenses: [] });
    if (path === "/api/comps/reviews") return json({ reviews: [], nextCursor: null });
    if (path === "/api/ebay/status") return json({ configured: true, connected: true, tokenSource: "db", hasPolicies: true, hasMerchantLocation: true });
    if (path === "/api/system/status") return json({ sources: [], summary: { livePrimaryComps: false, liveCatalogKey: false, secondaryCrossCheck: false, alertDelivery: false, storedSales: false } });
    if (path === "/api/deal-sessions") return json({ session: null, summary: { includedCount: 0, excludedCount: 0, totalMaxCashPence: 0, totalMaxTradePence: 0, totalExpectedProceedsPence: 0, totalExpectedProfitPence: 0, suggestedBundleOfferPence: 0, completionReady: false, completionBlockers: [] } });
    if (path === "/api/catalog/cards") return json({ cards: [] });
    if (path === "/api/catalog/sets" || path === "/api/catalog/search") return json({ sets: [] });
    fixture.unexpected.push(`${method} ${path}`);
    return json({ error: "Unexpected fixture request" }, 500);
  });
  return fixture;
}

function assertClean(fixture: EditorFixture) {
  expect(fixture.unexpected, "All APIs are mocked; no unexpected mutation or external request").toEqual([]);
  expect(fixture.pageErrors, "No uncaught browser errors").toEqual([]);
}
