import { expect, test, type BrowserContext, type Page, type Route } from "playwright/test";

const card = {
  id: "card-offline-1",
  name: "Gengar",
  setName: "Lost Origin Trainer Gallery",
  setCode: "swsh11tg",
  number: "TG06/TG30",
  imageUrl: null,
  displayImageUrl: null,
  game: "POKEMON",
  language: "EN",
};

const headline = {
  source: "checked-comps",
  card,
  grade: "RAW",
  currency: "GBP",
  medianPence: 4200,
  meanPence: 4200,
  lowPence: 3900,
  highPence: 4500,
  sampleSize: 7,
  windowDays: 90,
  trendPct: null,
  outliersRemoved: 1,
  asOf: new Date().toISOString(),
};

const reconciliation = {
  headlinePence: 4200,
  confidence: "medium",
  manualCheck: false,
  reasons: [],
  chosenSource: "checked-comps",
  trendPct: null,
};

test("offline buy stays visibly queued across reload and flushes once on reconnect", async ({ context, page }) => {
  let acquired = false;
  let acquireRequest: { mutationId?: string; body?: Record<string, unknown> } = {};
  await mockAppApis(context, () => acquired, (request) => {
    acquired = true;
    acquireRequest = request;
  });

  await page.goto("/?view=buy");
  await expect(page.getByTestId("offline-sync-status")).toContainText("Synced");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // Reload once under SW control so the real Next shell/chunks are runtime-cached.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.getByLabel("Smart comp search").fill("Gengar Lost Origin TG06/TG30 RAW £25");
  await page.getByRole("button", { name: "Comp current card" }).click();
  await expect(page.getByText("Suggested maximum buy")).toBeVisible();
  await expect(page.getByText(/7 traceable UK solds \/ 90d/)).toBeVisible();

  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("poke-deal-offline", 3);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction("comp-cache", "readonly").objectStore("comp-cache").count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => reject(count.error);
    };
    request.onerror = () => reject(request.error);
  }))).toBeGreaterThan(0);
  const failOfflineComp = (route: Route) => route.abort("internetdisconnected");
  await context.route("**/api/comps/stream**", failOfflineComp);

  // Prove the decision itself survives: reload offline, re-enter the same
  // typed identity, and receive the age/sample-badged IndexedDB receipt.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("Smart comp search").fill("Gengar Lost Origin TG06/TG30 RAW £25");
  await page.getByRole("button", { name: "Comp current card" }).click();
  await expect(page.getByText(/Offline receipt · \d+h old · 7 sold/)).toBeVisible();
  await expect(page.getByText(/cached \d+h/)).toBeVisible();

  // First tap reveals the prefilled stock details; the second records locally.
  await page.getByRole("button", { name: "Just bought it" }).click();
  const costInput = page.locator('.quick-stock-card').getByRole("textbox", { name: "Cost" });
  if (await costInput.isVisible()) await costInput.fill("25.00");
  await page.getByRole("button", { name: "Add to stock", exact: true }).click();

  await expect(page.getByTestId("offline-purchase")).toContainText("not yet synced");
  await expect(page.getByTestId("offline-sync-status")).toContainText(/Offline.*1/);
  expect(acquired).toBe(false);

  // Cold-ish offline reload: SW shell + IndexedDB bootstrap and mutation queue.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("offline-sync-status")).toContainText(/Offline.*1/);
  await expect(page.getByTestId("offline-queue-item")).toContainText("Buy Gengar");

  await context.unroute("**/api/comps/stream**", failOfflineComp);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => acquired).toBe(true);
  await expect(page.getByTestId("offline-sync-status")).toContainText("Synced");
  await expect(page.getByTestId("offline-queue-item")).toHaveCount(0);

  expect(acquireRequest.mutationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(acquireRequest.body).toMatchObject({ grade: "RAW", costBasisPence: 2500, quantity: 1 });
  await page.getByRole("button", { name: "Stock" }).click();
  await expect(page.getByText("Gengar", { exact: true }).first()).toBeVisible();
});

test("Quick Fill queues stock and its chosen listing when signal drops", async ({ context, page }) => {
  let acquired = false;
  let replay: { mutationId?: string; body?: Record<string, unknown> } = {};
  await mockAppApis(context, () => acquired, (request) => {
    acquired = true;
    replay = request;
  });

  await page.goto("/?view=buy");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.getByLabel("Smart comp search").fill("Gengar Lost Origin TG06/TG30 RAW £9");
  const fill = page.getByRole("button", { name: "Fill", exact: true }).last();
  await expect(fill).toBeVisible();
  await fill.click();
  const quickFill = page.locator(".fallback-stock-panel");
  await expect(quickFill.getByRole("heading", { name: "Add to stock" })).toBeVisible();
  await quickFill.getByLabel(/^What I paid/).fill("9.00");
  await quickFill.getByText("More stock and listing details", { exact: true }).click();
  await quickFill.getByLabel(/^Your list price/).fill("18.00");
  await quickFill.getByRole("button", { name: "Draft", exact: true }).click();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await quickFill.getByRole("button", { name: "Stock + eBay draft" }).click();

  await expect(page.getByTestId("offline-sync-status")).toContainText(/Offline.*1/);
  await expect(page.getByTestId("offline-queue-item")).toContainText("Quick Fill Gengar");
  expect(acquired).toBe(false);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("offline-queue-item")).toContainText("Quick Fill Gengar");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => acquired).toBe(true);
  await expect(page.getByTestId("offline-sync-status")).toContainText("Synced");
  expect(replay.mutationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(replay.body).toMatchObject({
    grade: "RAW",
    quantity: 1,
    costBasisPence: 900,
    createListing: true,
    listingState: "DRAFT",
  });
  expect(Number(replay.body?.listPricePence)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Stock" }).click();
  await expect(page.getByText("Gengar", { exact: true }).first()).toBeVisible();
});

test("Quick Fill keeps committed stock when draft creation loses the connection", async ({ context, page }) => {
  let acquired = false;
  let inventoryCreates = 0;
  let inventoryBody: Record<string, unknown> | undefined;
  await mockAppApis(context, () => acquired, (request) => {
    acquired = true;
    inventoryCreates += 1;
    inventoryBody = request.body;
  });
  await context.route("**/api/listings", async (route) => {
    if (route.request().method() === "POST") return route.abort("internetdisconnected");
    return route.fallback();
  });

  await page.goto("/?view=buy");
  // Set and collector number are intentionally unknown: omitted optional
  // identity must still be valid stock intake.
  await page.getByLabel("Smart comp search").fill("Gengar RAW £9");
  await page.getByRole("button", { name: "Fill", exact: true }).last().click();
  const quickFill = page.locator(".fallback-stock-panel");
  await expect(quickFill.getByRole("heading", { name: "Add to stock" })).toBeVisible();
  await quickFill.getByRole("button", { name: "Stock + eBay draft" }).click();

  await expect.poll(() => acquired).toBe(true);
  expect(inventoryCreates).toBe(1);
  expect(inventoryBody?.card).toMatchObject({ name: "Gengar" });
  expect(inventoryBody?.card).not.toHaveProperty("setName");
  expect(inventoryBody?.card).not.toHaveProperty("number");
  await expect(page.getByText(/Stocked manually, but the listing needs retry/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create draft", exact: true })).toBeVisible();
  expect(inventoryCreates).toBe(1);
});

test("offline last-copy sale stays reserved across reload and sync with a failed stock refresh", async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let sold = false;
  const saleIds: string[] = [];
  await mockAppApis(context, () => true, () => undefined);
  await context.route("**/api/inventory/item-offline-1/sell", async (route) => {
    saleIds.push(route.request().headers()["x-poke-deal-mutation-id"] ?? "");
    sold = true;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      item: { ...inventoryItem(), status: "SOLD", updatedAt: "2026-09-04T12:01:00.000Z" },
      profitPence: 500,
    }) });
  });
  await context.route("**/api/inventory", (route) => sold ? route.abort("failed") : route.fallback());

  await prepareOfflineStockPage(page);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await openOfflineSale(page);
  await page.locator(".sell-sheet").getByRole("button", { name: "Create sale", exact: true }).click();
  await expect.poll(() => pendingSales(page)).toBe(1);
  await expect(page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" })).toContainText("0 available");
  expect(saleIds).toEqual([]);

  await page.reload({ waitUntil: "domcontentloaded" });
  const stockRow = page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" });
  await expect(stockRow).toContainText("0 available");
  await expect(stockRow.getByRole("button", { name: "Sell", exact: true }).and(page.locator(":enabled"))).toHaveCount(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => sold).toBe(true);
  await expect.poll(() => pendingSales(page)).toBe(0);
  // The queue has acknowledged the server sale, but the stock GET deliberately
  // fails. Its receipt must keep the stale cached row unavailable.
  await expect(stockRow).toContainText("0 available");
  await expect(stockRow.getByRole("button", { name: "Sell", exact: true }).and(page.locator(":enabled"))).toHaveCount(0);
  await context.setOffline(true);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("offline-sync-status")).toContainText("Partial");
  expect(saleIds).toHaveLength(1);
  expect(saleIds[0]).toMatch(/^[0-9a-f-]{36}$/i);
});

test("concurrent offline sale forms cannot reserve the same last copy and unsent undo releases it", async ({ context, page }) => {
  await mockAppApis(context, () => true, () => undefined);
  await prepareOfflineStockPage(page);
  const other = await context.newPage();
  try {
    await other.goto("/?view=stock");
    await openOfflineSale(page);
    await openOfflineSale(other);
    await context.setOffline(true);
    await Promise.all([page, other].map((tab) => tab.evaluate(() => window.dispatchEvent(new Event("offline")))));
    await Promise.all([page, other].map((tab) => tab.locator(".sell-sheet").getByRole("button", { name: "Create sale", exact: true }).click()));
    await expect.poll(() => pendingSales(page)).toBe(1);
    await expect(page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" })).toContainText("0 available");
    await expect(other.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" })).toContainText("0 available");
    await expect.poll(async () => await page.getByRole("button", { name: "Undo", exact: true }).isVisible() || await other.getByRole("button", { name: "Undo", exact: true }).isVisible()).toBe(true);
    const winningPage = await page.getByRole("button", { name: "Undo", exact: true }).isVisible() ? page : other;
    await winningPage.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => pendingSales(page)).toBe(0);
    await expect(winningPage.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" }).getByRole("button", { name: "Sell", exact: true })).toBeEnabled();
  } finally {
    await other.close();
  }
});

test("confirmed online sale remains unavailable after a failed refresh and an offline reload", async ({ context, page }) => {
  let saleRequests = 0;
  await mockAppApis(context, () => true, () => undefined);
  await context.route("**/api/inventory/item-offline-1/sell", async (route) => {
    saleRequests += 1;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      item: { ...inventoryItem(), status: "SOLD", updatedAt: "2026-09-04T12:01:00.000Z" },
      profitPence: 500,
    }) });
  });
  await context.route("**/api/inventory", (route) => saleRequests > 0 ? route.abort("failed") : route.fallback());
  await prepareOfflineStockPage(page);
  await openOfflineSale(page);
  await page.locator(".sell-sheet").getByRole("button", { name: "Create sale", exact: true }).click();
  await expect.poll(() => saleRequests).toBe(1);
  await expect(page.locator(".sell-sheet")).toHaveCount(0);
  await page.getByRole("button", { name: "Stock", exact: true }).click();
  await expect.poll(() => pendingSales(page)).toBe(0);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await expect(page.locator(".inventory-workspace").getByRole("button", { name: "Sell", exact: true }).and(page.locator(":enabled"))).toHaveCount(0);
  expect(saleRequests).toBe(1);
});

test("an empty successful sale response stays reserved and retries the same sale ID", async ({ context, page }) => {
  const saleIds: string[] = [];
  let allowReconcile = false;
  await mockAppApis(context, () => true, () => undefined);
  await context.route("**/api/inventory/item-offline-1/sell", async (route) => {
    saleIds.push(route.request().headers()["x-poke-deal-mutation-id"] ?? "");
    // The server accepted the sale, but the first response lost its body.
    if (!allowReconcile) return route.fulfill({ status: 201, contentType: "application/json", body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      item: { ...inventoryItem(), status: "SOLD", updatedAt: "2026-09-04T12:01:00.000Z" },
      profitPence: 500, idempotent: true,
    }) });
  });
  await context.route("**/api/inventory", (route) => saleIds.length ? route.abort("failed") : route.fallback());
  await prepareOfflineStockPage(page);
  await openOfflineSale(page);
  await page.locator(".sell-sheet").getByRole("button", { name: "Create sale", exact: true }).click();
  await expect.poll(() => pendingSales(page)).toBe(1);
  await expect(page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" })).toContainText("0 available");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);

  // Reopening online also fails to fetch stock. The unresolved sale remains
  // reserved and its retry keeps the original idempotency key.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" })).toContainText("0 available");
  await page.getByRole("button", { name: "Comp / Buy", exact: true }).click();
  const queuedSale = page.getByTestId("offline-queue-item").filter({ hasText: "Sale Gengar" });
  await expect(queuedSale.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await queuedSale.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(() => pendingSales(page)).toBe(1);
  await expect(page.getByText(/This sale may already be recorded on the server/)).toBeVisible();
  allowReconcile = true;
  await queuedSale.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => pendingSales(page)).toBe(0);
  expect(saleIds.length).toBeGreaterThanOrEqual(2);
  expect(new Set(saleIds).size).toBe(1);
  expect(saleIds[0]).toMatch(/^[0-9a-f-]{36}$/i);

  await page.getByRole("button", { name: "Stock", exact: true }).click();
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" })).toContainText("0 available");
});

test("an uncertain queued sale blocks stale listing activation but still permits marketplace removal", async ({ context, page }) => {
  const now = new Date().toISOString();
  const draft = {
    id: "draft-offline-1", itemId: "item-offline-1", channel: "EBAY", state: "DRAFT",
    title: "Gengar", titleCustomized: false, listPrice: 3000, suggestedPrice: null,
    externalRef: null, externalUrl: null, createdAt: now, updatedAt: now,
  };
  const live = {
    ...draft, id: "live-offline-1", channel: "VINTED", state: "ACTIVE",
    externalRef: "vinted-offline-1", externalUrl: "https://www.vinted.co.uk/items/1234567890-gengar",
  };
  const listingWrites: Array<{ id: string; body: Record<string, unknown> }> = [];
  let saleRequests = 0;
  const stock = () => ({
    ...inventoryItem(), status: "LISTED", listings: [draft, live],
    photos: [{ id: "photo-offline-1", url: "/icon-512.png", origin: "REAL", role: "FRONT", order: 0, width: 512, height: 512 }],
  });
  await mockAppApis(context, () => true, () => undefined);
  await context.route("**/api/inventory", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [stock()] }) }));
  await context.route("**/api/listings**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/listings") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ listings: [draft, live].map((row) => ({ ...row, item: stock() })) }) });
    }
    if (request.method() !== "GET") {
      const id = path.split("/").at(-1)!;
      const body = request.postDataJSON() as Record<string, unknown>;
      listingWrites.push({ id, body });
      if (id === live.id && body.state === "ENDED") live.state = "ENDED";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ listing: { ...(id === live.id ? live : draft), ...body, item: stock() } }) });
    }
    return route.fallback();
  });
  await context.route("**/api/inventory/item-offline-1/sell", (route) => {
    saleRequests++;
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Sale acknowledgement unavailable" }) });
  });
  await prepareOfflineStockPage(page, true);
  const listingTab = await context.newPage();
  try {
    // The editor already permits activation before another tab reserves stock.
    await listingTab.goto("/?view=listings");
    const draftRow = listingTab.locator(".listing-select-row").filter({ has: listingTab.locator('input[name="select-listing-draft-offline-1"]') });
    await draftRow.getByText("More", { exact: true }).click();
    await draftRow.getByRole("button", { name: "Edit listing details", exact: true }).click();
    const editor = listingTab.locator(".sell-sheet");
    await editor.getByRole("combobox", { name: "State", exact: true }).selectOption("ACTIVE");
    await editor.getByRole("textbox", { name: "Listing URL", exact: true }).fill("https://www.ebay.co.uk/itm/123456789012");

    await context.setOffline(true);
    await openOfflineSale(page);
    await page.locator(".sell-sheet").getByRole("button", { name: "Create sale", exact: true }).click();
    await expect.poll(() => pendingSales(page)).toBe(1);
    const stockRow = page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" });
    await expect(stockRow).toContainText("0 available");
    await expect(stockRow).toContainText(/Sync sale/i);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.locator(".today-workspace")).toBeVisible();
    await expect(page.locator(".today-workspace").getByRole("heading", { name: /(?:prepare|publish).*(?:stock|draft)/i })).toHaveCount(0);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => saleRequests).toBeGreaterThan(0);
    await expect.poll(() => pendingSales(page)).toBe(1);
    await editor.getByRole("button", { name: "Save listing", exact: true }).click();
    await expect(listingTab.getByText(/Sync and refresh this card/)).toBeVisible();
    expect(listingWrites).toEqual([]);

    // Removing an existing marketplace listing reduces exposure and remains allowed.
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await listingTab.locator('select[name="listing-state"]').selectOption("ACTIVE");
    const liveRow = listingTab.locator(".listing-select-row").filter({ has: listingTab.locator('input[name="select-listing-live-offline-1"]') });
    await liveRow.getByText("More", { exact: true }).click();
    await liveRow.getByRole("button", { name: "End listing", exact: true }).click();
    await liveRow.getByRole("button", { name: "Confirm removed", exact: true }).click();
    await expect.poll(() => listingWrites.length).toBe(1);
    expect(listingWrites).toEqual([{ id: live.id, body: { state: "ENDED", externalRemovalConfirmed: true } }]);
    await expect.poll(() => pendingSales(page)).toBe(1);
  } finally {
    await listingTab.close();
  }
});

test("offline storage upgrade keeps existing queued sales and prevents old clients deleting receipts", async ({ context, page }) => {
  await mockAppApis(context, () => true, () => undefined);
  await page.goto("/privacy");
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("poke-deal-offline", 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("mutation-queue", { keyPath: "id" });
      request.result.createObjectStore("comp-cache", { keyPath: "key" });
      request.result.createObjectStore("bootstrap-cache", { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("mutation-queue", "readwrite");
      transaction.objectStore("mutation-queue").put({
        id: "legacy-queued-sale", kind: "mark-sold", endpoint: "/api/inventory/item-offline-1/sell", method: "POST",
        headers: {}, body: { quantity: 1 }, summary: { label: "Legacy queued Gengar sale", quantity: 1 },
        createdAt: "2026-09-04T12:00:00.000Z", updatedAt: "2026-09-04T12:00:00.000Z", attempts: 0,
        nextAttemptAt: null, lastError: null, requiresClient: true,
      });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }));
  await page.goto("/?view=stock");
  await expect(page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" })).toContainText("0 available");
  await expect.poll(() => pendingSales(page)).toBe(1);
  const oldClientError = await page.evaluate(() => new Promise<string>((resolve) => {
    const request = indexedDB.open("poke-deal-offline", 2);
    request.onerror = () => resolve(request.error?.name ?? "unknown");
    request.onsuccess = () => { request.result.close(); resolve("unexpectedly opened"); };
  }));
  expect(oldClientError).toBe("VersionError");
});

async function prepareOfflineStockPage(page: Page, showAll = false) {
  await page.goto("/?view=stock");
  if (showAll) await page.getByRole("group", { name: "Inventory filters" }).getByRole("button", { name: /^All / }).click();
  await expect(page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  if (showAll) await page.getByRole("group", { name: "Inventory filters" }).getByRole("button", { name: /^All / }).click();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("poke-deal-offline", 3);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("bootstrap-cache", "readonly").objectStore("bootstrap-cache").get("latest");
      read.onsuccess = () => { db.close(); resolve(read.result?.payload?.inventory?.length ?? 0); };
      read.onerror = () => reject(read.error);
    };
    request.onerror = () => reject(request.error);
  }))).toBe(1);
}

async function openOfflineSale(page: Page) {
  await page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" }).getByRole("button", { name: "Sell", exact: true }).click();
  const saleSheet = page.locator(".sell-sheet");
  await expect(saleSheet).toBeVisible();
  await saleSheet.getByRole("textbox", { name: /^Actual sale price/ }).fill("30.00");
  await saleSheet.getByRole("textbox", { name: "Fees", exact: true }).fill("0");
  await saleSheet.getByRole("textbox", { name: "My postage cost", exact: true }).fill("0");
}

async function pendingSales(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("poke-deal-offline", 3);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("mutation-queue", "readonly").objectStore("mutation-queue").getAll();
      read.onsuccess = () => { db.close(); resolve(read.result.filter((row) => row.kind === "mark-sold" && !row.syncedAt).length); };
      read.onerror = () => reject(read.error);
    };
    request.onerror = () => reject(request.error);
  }));
}

async function mockAppApis(
  context: BrowserContext,
  isAcquired: () => boolean,
  onAcquire: (request: { mutationId?: string; body?: Record<string, unknown> }) => void,
) {
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/comps/stream") {
      const reconciled = { headline, all: [headline], sourcesDisagree: false, reconciliation };
      const receipt = { ...reconciled, catalog: card, alternatives: [], ambiguous: false, psaCert: null, cardImage: { imageUrl: null, source: "none", listingSafe: false }, askEvidence: null };
      const base = { version: 1, lookupId: "offline-lookup", emittedAt: new Date().toISOString() };
      const events = [
        { ...base, sequence: 1, type: "catalog", requested: card, identity: card, grade: "RAW", catalog: card, ambiguity: false, sources: [{ name: "checked-comps", live: true }] },
        { ...base, sequence: 2, type: "source", source: { name: "checked-comps", live: true }, status: "priced", latencyMs: 12, completed: 1, total: 1, result: headline, receipt: reconciled },
        { ...base, sequence: 3, type: "verdict", phase: "provisional", ambiguity: false, pricedSourceCount: 1, receipt: reconciled },
        { ...base, sequence: 4, type: "receipt", latencyMs: 15, receipt },
      ];
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n` });
    }
    if (url.pathname === "/api/inventory/acquire") {
      const body = request.postDataJSON() as Record<string, unknown>;
      onAcquire({ mutationId: request.headers()["x-poke-deal-mutation-id"], body });
      return json({ item: inventoryItem(), suggestion: { pricePence: 4200 }, listing: null }, 201);
    }
    if (url.pathname === "/api/inventory") {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as Record<string, unknown>;
        onAcquire({ mutationId: request.headers()["x-poke-deal-mutation-id"], body });
        return json({ item: inventoryItem(), idempotent: false }, 201);
      }
      return json({ items: isAcquired() ? [inventoryItem()] : [] });
    }
    if (url.pathname === "/api/listings") return json({ listings: [] });
    if (url.pathname === "/api/dashboard") return json({
      metrics: { stockCount: isAcquired() ? 1 : 0, listedCount: 0, soldCount: 0, realizedProfitPence: 0, operatingExpensePence: 0, agedStockCount: 0, channelBreakdown: [] },
      listingsByState: { DRAFT: 0, ACTIVE: 0, SOLD: 0, ENDED: 0 }, staleStock: [], recentSales: [], recentExpenses: [],
    });
    if (url.pathname === "/api/snapshots/portfolio") return json({ points: [], latest: null, previous: null, changePence: null, changePct: null });
    if (url.pathname === "/api/watches") return json({ watches: [] });
    if (url.pathname === "/api/alerts/inbox") return json({ alerts: [], unreadCount: 0 });
    if (url.pathname === "/api/expenses") return json({ expenses: [] });
    if (url.pathname === "/api/system/status") return json({ sources: [], summary: { livePrimaryComps: true, secondaryCrossCheck: true, alertDelivery: false, storedSales: false } });
    if (url.pathname === "/api/deal-sessions") return json({ session: null, summary: { includedCount: 0, excludedCount: 0, totalMaxCashPence: 0, totalMaxTradePence: 0, totalExpectedProceedsPence: 0, totalExpectedProfitPence: 0, suggestedBundleOfferPence: 0, completionReady: false, completionBlockers: [] } });
    if (url.pathname === "/api/comps/reviews") return json({ reviews: [], nextCursor: null });
    if (url.pathname === "/api/ebay/status") return json({ configured: false, connected: false });
    if (url.pathname === "/api/catalog/sets") return json({ sets: [] });
    if (url.pathname === "/api/catalog/cards") return json({ cards: [] });
    return json({});
  });
}

function inventoryItem() {
  return {
    id: "item-offline-1",
    card,
    grade: "RAW",
    quantity: 1,
    costBasis: 2500,
    acquiredFrom: "Card fair",
    location: "Box A",
    condition: "NM",
    graderCert: null,
    status: "IN_STOCK",
    createdAt: new Date().toISOString(),
    updatedAt: "2026-09-04T12:00:00.000Z",
    listings: [],
    sales: [],
    photos: [],
  };
}
