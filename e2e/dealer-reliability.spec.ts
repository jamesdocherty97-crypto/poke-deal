import { expect, test, type BrowserContext } from "playwright/test";

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
test.setTimeout(60_000);

const BATCH_KEY = "poke-deal.opening-stock-batch.v1";
const CSV = `card,set,number,grade,cost,qty,condition,channel,list price
Gengar,Lost Origin Trainer Gallery,TG06/TG30,RAW,10,1,NM,EBAY,25
Pikachu,Base Set,58/102,RAW,3,1,LP,EBAY,8
Eevee,Jungle,51/64,RAW,2,1,NM,EBAY,6`;

test("opening stock resumes a lost draft acknowledgement without repeating confirmed stock", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  ledger.loseFirstDraftAcknowledgement = true;
  await mockReliabilityApis(context, ledger);

  await page.goto("/?view=today");
  await page.getByRole("button", { name: "Import stock", exact: true }).click();
  await page.getByRole("textbox", { name: "Paste rows", exact: true }).fill(CSV);
  await page.getByRole("button", { name: "Import 3 rows", exact: true }).click();
  await expect(page.getByText(/Resume this batch to continue safely/)).toBeVisible();
  expect(ledger.items).toHaveLength(1);
  expect(ledger.listings).toHaveLength(1);
  expect(ledger.stockRequests).toHaveLength(1);
  const paused = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), BATCH_KEY);
  expect(paused.rows[0].itemId).toBe(ledger.items[0].id);
  expect(paused.rows[0].listingId).toBeUndefined();
  const originalIds = paused.rows.map((row: { mutationId: string }) => row.mutationId);

  await page.reload();
  const resume = page.getByRole("button", { name: "Resume import", exact: true });
  if (!(await resume.isVisible())) await page.getByText("Opening stock import", { exact: true }).click();
  await expect(resume).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Paste rows", exact: true })).toHaveValue(CSV);
  await resume.click();
  await expect(page.getByText(/Your squad is stocked: 3 cards and drafts saved/)).toBeVisible();
  expect(ledger.items).toHaveLength(3);
  expect(ledger.listings).toHaveLength(3);
  expect(ledger.stockRequests).toEqual(originalIds);
  expect(ledger.draftRequests).toEqual([`${originalIds[0]}:draft`, `${originalIds[0]}:draft`, `${originalIds[1]}:draft`, `${originalIds[2]}:draft`]);
  expect(new Set(ledger.items.map((item) => item.id)).size).toBe(3);
  expect(await page.evaluate((key) => localStorage.getItem(key), BATCH_KEY)).toBeNull();
  await page.reload();
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".market-list .item-row")).toHaveCount(3);
  expect(ledger.stockRequests).toHaveLength(3);
});

test("Today leads with a prepared draft despite reviews and Stock never counts the draft as live", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  ledger.addPreparedDraft();
  ledger.reviews = [manualReview()];
  await mockReliabilityApis(context, ledger);

  await page.goto("/?view=today");
  await expect(page.getByRole("heading", { name: "Publish 1 prepared draft", exact: true })).toBeVisible();
  // Path B keeps optional research secondary inside the collapsed Quest log.
  await page.locator("details.today-more-moves > summary").click();
  await expect(page.getByRole("button", { name: /Professor.s review · optional research/ })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "First-sale quest" })).toHaveAttribute("aria-valuenow", "2");
  await expect(page.locator(".today-command-progress")).toContainText("Next: a live listing");
  await page.getByRole("button", { name: "Open stock vault", exact: true }).first().click();
  const filters = page.getByRole("group", { name: "Inventory filters" });
  await expect(filters.getByRole("button", { name: /^Needs action/ })).toContainText("1");
  await expect(filters.getByRole("button", { name: /^Drafts/ })).toContainText("1");
  await expect(filters.getByRole("button", { name: /^Live/ })).toContainText("0");
  await filters.getByRole("button", { name: /^Live/ }).click();
  await expect(page.getByText("No confirmed live listings yet. Drafts are waiting to be published.")).toBeVisible();
  await filters.getByRole("button", { name: /^Drafts/ }).click();
  await expect(page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" })).toBeVisible();
});

test("Profit leaves legacy cost blank and saves confirmed snapshots with a required reason", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  ledger.addLegacySale();
  await mockReliabilityApis(context, ledger);

  await page.goto("/?view=profit");
  const reconciliation = page.getByRole("region", { name: "Confirm sale costs", exact: true });
  await reconciliation.getByRole("button", { name: "Confirm actual costs", exact: true }).click();
  const editor = page.getByRole("form", { name: "Confirm costs for Gengar" });
  await expect(editor.getByRole("textbox", { name: "Acquisition cost per copy (£)", exact: true })).toHaveValue("");
  await editor.getByRole("textbox", { name: "Actual fees (£)", exact: true }).fill("3.00");
  await editor.getByRole("textbox", { name: "Actual seller postage and packing (£)", exact: true }).fill("2.00");
  await editor.getByRole("textbox", { name: "Reason or receipt checked", exact: true }).fill("Checked original purchase and postage receipts");
  await editor.getByRole("checkbox").check();
  await editor.getByRole("button", { name: "Save confirmed costs", exact: true }).click();
  await expect(page.getByText(/Acquisition cost per copy: enter pounds/)).toBeVisible();
  expect(ledger.corrections).toHaveLength(0);

  await editor.getByRole("textbox", { name: "Acquisition cost per copy (£)", exact: true }).fill("25.00");
  await editor.getByRole("textbox", { name: "Item-only revenue (£, optional)", exact: true }).fill("48.00");
  await editor.getByRole("textbox", { name: "Reason or receipt checked", exact: true }).fill("");
  await editor.getByRole("button", { name: "Save confirmed costs", exact: true }).click();
  expect(await editor.getByRole("textbox", { name: "Reason or receipt checked", exact: true }).evaluate((node: HTMLTextAreaElement) => node.validity.valueMissing)).toBe(true);
  expect(ledger.corrections).toHaveLength(0);
  await editor.getByRole("textbox", { name: "Reason or receipt checked", exact: true }).fill("Checked original purchase and postage receipts");
  await editor.getByRole("button", { name: "Save confirmed costs", exact: true }).click();
  await expect(page.getByText("Costs confirmed", { exact: true })).toBeVisible();
  expect(ledger.corrections).toEqual([{
    feesPence: 300, postagePence: 200, costBasisPence: 2500, itemRevenuePence: 4800,
    reason: "Checked original purchase and postage receipts",
  }]);
  expect(ledger.sale!.amountRevisions[0].previous.costBasis).toBeNull();
  await expect(page.getByRole("heading", { name: "Confirm sale costs", exact: true })).toHaveCount(0);
  await expect(page.locator(".profit-overview-lead").getByText("£20.00", { exact: true }).first()).toBeVisible();
  ledger.items[0].costBasis = 12000;
  await page.reload();
  await expect(page.getByText(/Per copy · fees £3.00 · postage £2.00 · cost £25.00/)).toBeVisible();
  await expect(page.locator(".profit-overview-lead").getByText("£20.00", { exact: true }).first()).toBeVisible();
  expect(ledger.sale!.salePrice).toBe(5000);
});

test("Today explains a failed dashboard load instead of an empty business", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  let dashboardFails = true;
  await mockReliabilityApis(context, ledger);
  await context.route("**/api/dashboard", (route) => {
    if (!dashboardFails) return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "database unavailable" }),
    });
  });

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
  await page.goto("/?view=today");

  const loadAlert = page.locator(".today-workspace").getByRole("alert");
  await expect(loadAlert).toContainText("Couldn't load sales. Stock on this device is empty, so this is not a new business.");
  await expect(page.getByRole("heading", { name: "Load your existing singles", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sales didn't load", exact: true })).toBeVisible();
  await expect(page.locator(".today-command-progress")).toContainText("Sales have to load before this quest can move.");
  await expect(page.locator(".dealer-pulse-footer")).toContainText("Not loaded");
  await expect(page.locator(".dealer-pulse-footer")).not.toContainText("£0.00");

  dashboardFails = false;
  await loadAlert.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Load your existing singles", exact: true })).toBeVisible();
  await expect(page.locator(".today-workspace").getByRole("alert")).toHaveCount(0);
});

test("Today keeps the load alert through two failed inventory retries", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  let inventoryFails = true;
  await mockReliabilityApis(context, ledger);
  await context.route("**/api/inventory", (route) => {
    if (route.request().method() !== "GET" || !inventoryFails) return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "database unavailable" }),
    });
  });

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
  await page.goto("/?view=today");

  const loadAlert = page.locator(".today-workspace").getByRole("alert");
  const emptyBusiness = page.getByRole("heading", { name: "Load your existing singles", exact: true });
  await expect(loadAlert).toContainText("Couldn't load stock. No sales are on the loaded ledger, so this is not a new business.");
  await expect(page.getByRole("heading", { name: "Stock didn't load", exact: true })).toBeVisible();
  await expect(emptyBusiness).toHaveCount(0);

  async function expectAlertAfterFailedRetry() {
    const inventory = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/inventory" && response.request().method() === "GET" && response.status() === 500;
    });
    const dashboard = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/dashboard" && response.request().method() === "GET";
    });
    await loadAlert.getByRole("button", { name: "Retry", exact: true }).click();
    await inventory;
    await dashboard;
    await expect(loadAlert).toContainText("Couldn't load stock. No sales are on the loaded ledger, so this is not a new business.");
    await expect(page.getByRole("heading", { name: "Stock didn't load", exact: true })).toBeVisible();
    await expect(emptyBusiness).toHaveCount(0);
  }

  await expectAlertAfterFailedRetry();
  await expectAlertAfterFailedRetry();

  inventoryFails = false;
  const inventory = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/inventory" && response.request().method() === "GET" && response.ok();
  });
  await loadAlert.getByRole("button", { name: "Retry", exact: true }).click();
  await inventory;
  await expect(emptyBusiness).toBeVisible();
  await expect(page.locator(".today-workspace").getByRole("alert")).toHaveCount(0);
});

test("empty stock on Needs action says No active stock, not squad is ready", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  await abortNonLoopback(context);
  await mockReliabilityApis(context, ledger);
  await page.goto("/?view=stock");
  const workspace = page.locator(".inventory-workspace");
  await expect(workspace).toContainText("No active stock. Add your next card from Comp / Buy.", { timeout: 30_000 });
  await expect(workspace).not.toContainText("squad is ready");
});

test("Stock 500 on first load shows the alert with Retry, not an empty book", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  await abortNonLoopback(context);
  await mockReliabilityApis(context, ledger);
  await failCoreGets(context, ["/api/inventory", "/api/listings", "/api/dashboard"]);
  await page.goto("/?view=stock");
  const alert = page.locator(".inventory-workspace [role=alert]");
  await expect(alert).toContainText("Couldn't load your stock and sales", { timeout: 30_000 });
  await expect(alert.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.locator(".inventory-workspace")).not.toContainText("No active stock");
});

test("List 500 on first load shows the alert with Retry", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  await abortNonLoopback(context);
  await mockReliabilityApis(context, ledger);
  await failCoreGets(context, ["/api/listings"]);
  await page.goto("/?view=list");
  const alert = page.locator(".listings-workspace [role=alert]");
  await expect(alert.getByRole("button", { name: "Retry", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText("Couldn't load your stock and sales");
});

test("Today keeps a loaded stock mission when sales fail on a cold start", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  ledger.addPreparedDraft();
  let dashboardFails = true;
  await abortNonLoopback(context);
  await mockReliabilityApis(context, ledger);
  await context.route("**/api/dashboard", (route) => {
    if (!dashboardFails) return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "database unavailable" }),
    });
  });
  await page.goto("/?view=today");
  const workspace = page.locator(".today-workspace");
  const banner = workspace.locator(".load-banner");
  await expect(banner).toContainText("Couldn't load sales. Stock already loaded stays on screen.", { timeout: 30_000 });
  await expect(workspace.getByRole("heading", { name: "Publish 1 prepared draft", exact: true })).toBeVisible();
  await expect(workspace.locator(".today-mission-card")).toContainText("Gengar");
  await expect(workspace.getByRole("heading", { name: "Load your existing singles", exact: true })).toHaveCount(0);
  await expect(workspace.locator(".today-command-progress")).toContainText("Paused");
  await expect(workspace.locator(".today-command-progress")).not.toContainText("0/4");
  await expect(workspace.locator(".dealer-pulse-status button").filter({ hasText: "sold" })).toContainText("—");
  await expect(workspace.locator(".dealer-pulse-footer")).toContainText("Not loaded");
  await expect(workspace.locator(".today-action-list")).toHaveCount(0);
  const retry = banner.getByRole("button", { name: "Retry", exact: true });
  const retryBox = await retry.boundingBox();
  expect(retryBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(retryBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  const missionAction = workspace.getByRole("button", { name: "Open listing desk", exact: true });
  await missionAction.scrollIntoViewIfNeeded();
  const actionBox = await missionAction.boundingBox();
  const viewport = page.viewportSize();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.y).toBeGreaterThanOrEqual(0);
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual((viewport?.height ?? 0) - 72);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 320, height: 720 });
  const overflow320 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow320).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });

  dashboardFails = false;
  await retry.click();
  await expect(workspace.getByRole("alert")).toHaveCount(0);
  await expect(workspace.getByRole("heading", { name: "Publish 1 prepared draft", exact: true })).toBeVisible();
  await expect(workspace.locator(".dealer-pulse-status button").filter({ hasText: "sold" })).toContainText("0");
  await expect(workspace.locator(".today-command-progress")).not.toContainText("Paused");
});

test("Today reviews loaded sales when stock fails on a cold start", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  ledger.addLegacySale();
  await abortNonLoopback(context);
  await mockReliabilityApis(context, ledger);
  await failCoreGets(context, ["/api/inventory"]);
  await page.goto("/?view=today");
  const workspace = page.locator(".today-workspace");
  await expect(workspace.locator(".load-banner")).toContainText("Couldn't load stock. Sales already loaded are still shown.", { timeout: 30_000 });
  await expect(workspace.getByRole("heading", { name: "Confirm costs on 1 sale", exact: true })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Load your existing singles", exact: true })).toHaveCount(0);
  await expect(workspace.locator(".today-command-progress")).toContainText("Stock has to load before this quest can move.");
  await expect(workspace.locator(".dealer-pulse-status button").filter({ hasText: "live stock" })).toContainText("—");
  await expect(workspace.locator(".dealer-pulse-status button").filter({ hasText: "sold" })).toContainText("1");
});

test("Today blocks the mission when stock and sales both fail on a cold start", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  ledger.addPreparedDraft();
  await abortNonLoopback(context);
  await mockReliabilityApis(context, ledger);
  await failCoreGets(context, ["/api/inventory", "/api/dashboard"]);
  await page.goto("/?view=today");
  const workspace = page.locator(".today-workspace");
  const alert = workspace.getByRole("alert");
  await expect(alert).toContainText("Couldn't load your stock and sales. Check signal and try again.", { timeout: 30_000 });
  await expect(workspace.getByRole("heading", { name: "Publish 1 prepared draft", exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("heading", { name: "Load your existing singles", exact: true })).toHaveCount(0);
  await expect(workspace.locator(".load-banner")).toHaveCount(0);
  await expect(alert.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
});

test("Today names a listings miss and keeps the stock mission", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  ledger.addPreparedDraft();
  await abortNonLoopback(context);
  await mockReliabilityApis(context, ledger);
  await failCoreGets(context, ["/api/listings"]);
  await page.goto("/?view=today");
  const workspace = page.locator(".today-workspace");
  await expect(workspace.locator(".load-banner")).toContainText("Couldn't load listings. Your stock and sales are still shown.", { timeout: 30_000 });
  await expect(workspace.getByRole("heading", { name: "Publish 1 prepared draft", exact: true })).toBeVisible();
  await expect(workspace.locator(".today-command-progress")).not.toContainText("Paused");
  await expect(workspace.locator(".dealer-pulse-status button").filter({ hasText: "draft" })).toContainText("1");
  await expect(workspace.getByRole("heading", { name: "Load your existing singles", exact: true })).toHaveCount(0);
});

test("partial inventory success keeps the stock row when listings fail", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  ledger.addPreparedDraft();
  await abortNonLoopback(context);
  await mockReliabilityApis(context, ledger);
  await failCoreGets(context, ["/api/listings"]);
  await page.goto("/?view=stock");
  const workspace = page.locator(".inventory-workspace");
  await expect(workspace.locator(".item-row").filter({ hasText: "Gengar" })).toBeVisible({ timeout: 30_000 });
  const banner = workspace.locator(".load-banner");
  await expect(banner).toContainText("Couldn't load listings");
  await expect(banner.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
});

test("partial listings success keeps list rows when sales fail", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  ledger.addPreparedDraft();
  await abortNonLoopback(context);
  await mockReliabilityApis(context, ledger);
  await failCoreGets(context, ["/api/dashboard"]);
  await page.goto("/?view=list");
  const workspace = page.locator(".listings-workspace");
  await expect(workspace.locator(".item-row").filter({ hasText: "Gengar" })).toBeVisible({ timeout: 30_000 });
  const banner = workspace.locator(".load-banner");
  await expect(banner).toContainText("Couldn't load sales");
  await expect(banner.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(workspace.locator("#listings-title")).toBeVisible();
});

test("Retry double-tap starts one stock bootstrap", async ({ context, page }) => {
  const ledger = new ReliabilityLedger();
  let inventoryGets = 0;
  let holdRetries = false;
  let releaseHold = () => {};
  const hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  await abortNonLoopback(context);
  await mockReliabilityApis(context, ledger);
  await context.route("**/api/inventory", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    inventoryGets += 1;
    if (holdRetries) await hold;
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "database unavailable" }),
    });
  });
  await page.goto("/?view=stock");
  const retry = page.locator(".inventory-workspace").getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible({ timeout: 30_000 });
  const baseline = inventoryGets;
  holdRetries = true;
  await retry.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect.poll(() => inventoryGets, { timeout: 10_000 }).toBeGreaterThan(baseline);
  await page.waitForTimeout(400);
  expect(inventoryGets - baseline).toBe(1);
  const busy = page.locator(".inventory-workspace").getByRole("button", { name: "Retrying…", exact: true });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");
  releaseHold();
});

class ReliabilityLedger {
  items: any[] = [];
  listings: any[] = [];
  reviews: any[] = [];
  sale: any = null;
  corrections: any[] = [];
  stockRequests: string[] = [];
  draftRequests: string[] = [];
  loseFirstDraftAcknowledgement = false;
  readonly now = new Date().toISOString();

  addPreparedDraft() {
    this.items.push(this.stockItem("item-1", { card: { name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06/TG30" }, grade: "RAW", condition: "NM", costBasisPence: 2500, quantity: 1 }));
    this.items[0].photos = [{ id: "photo-1", url: "/icon-512.png", origin: "REAL", role: "FRONT", order: 0, width: 512, height: 512 }];
    this.listings.push(this.draft("listing-1", "item-1", 4500, "EBAY"));
  }

  addLegacySale() {
    this.addPreparedDraft();
    this.items[0].status = "SOLD";
    this.items[0].costBasis = 9000;
    this.listings[0].state = "SOLD";
    this.sale = { id: "sale-legacy-1", itemId: "item-1", channel: "EBAY", salePrice: 5000, fees: 650, postage: 175, costBasis: null, itemRevenue: null, costsEstimated: true, amountRevisions: [], soldAt: this.now };
  }

  stockItem(id: string, body: any) {
    return { id, card: { id: `card-${id}`, imageUrl: null, displayImageUrl: null, game: "POKEMON", language: "EN", ...body.card }, grade: body.grade, condition: body.condition ?? null, quantity: body.quantity ?? 1, costBasis: body.costBasisPence, status: "IN_STOCK", acquiredAt: this.now, acquiredFrom: body.acquiredFrom ?? "Opening stock", location: body.location ?? "Binder A", graderCert: null, photos: [], createdAt: this.now, updatedAt: this.now };
  }

  draft(id: string, itemId: string, price: number | null, channel: string) {
    return { id, itemId, channel, state: "DRAFT", title: this.items.find((item) => item.id === itemId)?.card.name, listPrice: price, suggestedPrice: null, externalRef: null, externalUrl: null, listedAt: null, endedAt: null, createdAt: this.now, updatedAt: this.now };
  }

  inventory() { return this.items.map((item) => ({ ...item, listings: this.listings.filter((listing) => listing.itemId === item.id), sales: this.sale?.itemId === item.id ? [this.sale] : [] })); }
  listingRows() { return this.listings.map((listing) => ({ ...listing, item: this.inventory().find((item) => item.id === listing.itemId) })); }

  dashboard() {
    const cost = this.sale ? this.sale.costBasis ?? this.items[0].costBasis : 0;
    const profit = this.sale ? this.sale.salePrice - this.sale.fees - this.sale.postage - cost : 0;
    const summary = this.sale ? { id: this.sale.id, itemId: this.sale.itemId, name: "Gengar", grade: "RAW", channel: "EBAY", salePricePence: this.sale.salePrice, feesPence: this.sale.fees, postagePence: this.sale.postage, costBasisPence: cost, itemRevenuePence: this.sale.itemRevenue, costBasisEstimated: this.sale.costBasis == null, costsEstimated: this.sale.costsEstimated, amountRevisionCount: this.sale.amountRevisions.length, profitPence: profit, marginPct: profit / 50, soldAt: this.now, undoable: false } : null;
    const provisional = summary && (summary.costsEstimated || summary.costBasisEstimated) ? 1 : 0;
    return { metrics: {
      stockCount: this.items.filter((item) => item.status !== "SOLD").length, listedCount: 0, soldCount: this.sale ? 1 : 0, reservedCount: 0,
      activeCostPence: this.items.filter((item) => item.status !== "SOLD").reduce((sum, item) => sum + item.costBasis * item.quantity, 0), soldCostPence: cost,
      realizedRevenuePence: this.sale?.salePrice ?? 0, realizedFeesPence: this.sale?.fees ?? 0, realizedPostagePence: this.sale?.postage ?? 0,
      realizedProfitPence: profit, operatingExpensePence: 0, netProfitPence: profit, cashInPence: this.sale?.salePrice ?? 0, cashOutPence: cost,
      cashNetPence: profit, cashRecoveryPct: 0, realizedMarginPct: summary?.marginPct ?? null, sellThroughPct: this.sale ? 100 : 0,
      averageAgeDays: 0, agedStockCount: 0, channelBreakdown: [], bestSale: summary, worstSale: summary, provisionalSaleCount: provisional,
    }, listingsByState: { DRAFT: this.listings.filter((listing) => listing.state === "DRAFT").length, ACTIVE: 0, SOLD: this.sale ? 1 : 0, ENDED: 0 },
    recentSales: summary ? [summary] : [], salesToReconcile: provisional ? [summary] : [], salesToReconcileCount: provisional, recentExpenses: [], monthlyPnl: [], staleStock: [] };
  }
}

async function abortNonLoopback(context: BrowserContext) {
  await context.route("**/*", (route) => {
    let host = "";
    try { host = new URL(route.request().url()).hostname; } catch { host = ""; }
    if (host === "127.0.0.1" || host === "localhost") return route.fallback();
    return route.abort();
  });
}

async function failCoreGets(context: BrowserContext, pathnames: string[]) {
  await context.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === "GET" && pathnames.includes(pathname)) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "database unavailable" }),
      });
    }
    return route.fallback();
  });
}

async function mockReliabilityApis(context: BrowserContext, ledger: ReliabilityLedger) {
  await context.route("https://**", (route) => route.abort());
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/inventory" && method === "POST") {
      const key = request.headers()["x-poke-deal-mutation-id"];
      expect(key).toMatch(/^import:/);
      ledger.stockRequests.push(key!);
      let item = ledger.items.find((row) => row.clientMutationId === key);
      if (!item) { item = { ...ledger.stockItem(`imported-${ledger.items.length + 1}`, request.postDataJSON()), clientMutationId: key }; ledger.items.push(item); }
      return json({ item: ledger.inventory().find((row) => row.id === item.id) }, 201);
    }
    if (pathname === "/api/listings" && method === "POST") {
      const key = request.headers()["x-poke-deal-mutation-id"];
      expect(key).toMatch(/^import:.*:draft$/);
      ledger.draftRequests.push(key!);
      let listing = ledger.listings.find((row) => row.clientMutationId === key);
      if (!listing) { const body = request.postDataJSON(); listing = { ...ledger.draft(`draft-${ledger.listings.length + 1}`, body.itemId, body.listPricePence ?? null, body.channel), clientMutationId: key }; ledger.listings.push(listing); }
      if (ledger.loseFirstDraftAcknowledgement) { ledger.loseFirstDraftAcknowledgement = false; return json({ error: "Draft saved but its acknowledgement was interrupted." }, 502); }
      return json({ listing }, 201);
    }
    if (pathname === "/api/sales/sale-legacy-1" && method === "PATCH") {
      const body = request.postDataJSON();
      ledger.corrections.push(body);
      const previous = { costBasis: ledger.sale.costBasis, fees: ledger.sale.fees, postage: ledger.sale.postage, itemRevenue: ledger.sale.itemRevenue };
      ledger.sale = { ...ledger.sale, costBasis: body.costBasisPence, fees: body.feesPence, postage: body.postagePence, itemRevenue: body.itemRevenuePence, costsEstimated: false, amountRevisions: [...ledger.sale.amountRevisions, { reason: body.reason, previous }] };
      return json({ ok: true, sale: ledger.sale });
    }
    if (pathname === "/api/inventory") return json({ items: ledger.inventory() });
    if (pathname === "/api/listings") return json({ listings: ledger.listingRows() });
    if (pathname === "/api/dashboard") return json(ledger.dashboard());
    if (pathname === "/api/comps/reviews") return json({ reviews: ledger.reviews, nextCursor: null });
    if (pathname === "/api/snapshots/portfolio") return json({ points: [], latest: null, previous: null, changePence: null, changePct: null });
    if (pathname === "/api/watches") return json({ watches: [] });
    if (pathname === "/api/alerts/inbox") return json({ alerts: [], unreadCount: 0 });
    if (pathname === "/api/expenses") return json({ expenses: [] });
    if (pathname === "/api/ebay/status") return json({ configured: false, connected: false });
    if (pathname === "/api/ebay/orders/sync" && method === "GET") return json({ unmatched: [], unmatchedCount: 0, unmatchedPreviewCount: 0, lastSuccessfulSyncAt: null, lastSuccessfulSyncJob: null, lastSuccessfulSyncSource: "unknown" });
    if (pathname === "/api/system/status") return json({ sources: [], summary: { livePrimaryComps: false, liveCatalogKey: false, secondaryCrossCheck: false, alertDelivery: false, storedSales: Boolean(ledger.sale) } });
    if (pathname === "/api/deal-sessions") return json({ session: null, summary: { includedCount: 0, excludedCount: 0, totalMaxCashPence: 0, totalMaxTradePence: 0, totalExpectedProceedsPence: 0, totalExpectedProfitPence: 0, suggestedBundleOfferPence: 0, completionReady: false, completionBlockers: [] } });
    if (pathname === "/api/catalog/cards") return json({ cards: [] });
    if (pathname.startsWith("/api/catalog/")) return json({ sets: [] });
    if (/^\/api\/cards\/[^/]+\/price-history$/.test(pathname)) return json({ snapshots: [], comps: [], listings: [], sales: [] });
    return json({});
  });
}

function manualReview() {
  const now = new Date().toISOString();
  return { id: "review-1", card: { id: "review-card", name: "Mew", setName: "151", number: "205/165", imageUrl: null, displayImageUrl: null }, grade: "RAW", condition: "NM", headlinePence: 3500, source: "checked-comps", sampleSize: 2, windowDays: 90, asOf: now, confidence: "low", manualCheck: true, reasons: ["cross-source-spread"], receipt: null, createdAt: now, resolvedAt: null, resolution: null, resolutionNote: null, reviewRequestedAt: now, reviewExpiresAt: null };
}
