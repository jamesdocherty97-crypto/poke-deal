import { expect, test, type BrowserContext, type Route } from "playwright/test";

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
  await expect(page.getByText("Pay up to")).toBeVisible();
  await expect(page.getByText(/7 sold \/ 90d/)).toBeVisible();

  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("poke-deal-offline", 2);
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
  await page.getByRole("button", { name: "Just bought it" }).click();

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
  await expect(quickFill.getByRole("heading", { name: "Stock this card" })).toBeVisible();
  await quickFill.getByRole("textbox", { name: "Cost" }).fill("9.00");
  await quickFill.getByText("More stock and listing details", { exact: true }).click();
  await quickFill.getByRole("button", { name: "Draft", exact: true }).click();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await quickFill.getByRole("button", { name: "Stock + draft" }).click();

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
      metrics: { stockCount: isAcquired() ? 1 : 0, listedCount: 0, soldCount: 0, realizedProfitPence: 0, operatingExpensePence: 0, agedStockCount: 0 },
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
    listings: [],
    sales: [],
    photos: [],
  };
}
