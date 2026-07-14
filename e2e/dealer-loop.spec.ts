import { expect, test, type BrowserContext } from "playwright/test";

const CARD = {
  id: "card-fixture-gengar",
  tcgApiId: "swsh11tg-TG06",
  name: "Gengar",
  setName: "Lost Origin Trainer Gallery",
  setCode: "swsh11tg",
  number: "TG06/TG30",
  imageUrl: null,
  displayImageUrl: null,
  game: "POKEMON",
  language: "EN",
};

test("buy workspace keeps the fast path focused and reveals precision controls on demand", async ({ context, page }) => {
  await mockDealerApis(context, new FixtureDealerLedger());

  await page.goto("/?view=buy");

  await expect(page.getByLabel("Smart comp search")).toBeVisible();
  await expect(page.locator(".smart-grade-strip button")).toHaveCount(4);
  await expect(page.getByLabel("Card", { exact: true })).toBeHidden();
  await expect(page.getByRole("group", { name: "After stock" })).toBeHidden();

  await page.getByText("Exact card details", { exact: true }).click();
  await expect(page.getByLabel("Card", { exact: true })).toBeVisible();

  await page.getByText("Buy defaults", { exact: true }).click();
  await expect(page.getByRole("group", { name: "After stock" })).toBeVisible();
});

test("stock and list show loading skeletons instead of false zero states", async ({ context, page }) => {
  await mockDealerApis(context, new FixtureDealerLedger(), { criticalDelayMs: 2500 });
  const listPage = await context.newPage();
  await Promise.all([page.goto("/?view=stock"), listPage.goto("/?view=list")]);
  await expect(page.locator(".inventory-workspace .workspace-skeleton")).toBeVisible();
  await expect(listPage.locator(".listings-workspace .workspace-skeleton")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await expect(listPage.getByRole("heading", { name: "Listings" })).toBeVisible();
  await listPage.close();
});

test("fixture dealer loop: comp -> buy -> stock -> draft -> sell -> profit", async ({ context, page }) => {
  const ledger = new FixtureDealerLedger();
  await mockDealerApis(context, ledger);

  await page.goto("/?view=buy");
  await expect(page.getByLabel("Smart comp search")).toBeVisible();

  // Identity and cost are entered through the real smart-intake control. The
  // progressive endpoint below returns catalog, source, verdict, and receipt
  // events exactly as production does.
  await page.getByLabel("Smart comp search").fill("Gengar Lost Origin TG06/TG30 RAW £25");
  await page.getByRole("button", { name: "Comp current card" }).click();

  const compPanel = page.locator(".comp-panel");
  await expect(compPanel.getByText("Suggested maximum buy", { exact: true })).toBeVisible();
  await expect(compPanel).toContainText("7 sold / 90d");
  await expect(compPanel).toContainText(/7 sold \/ 90d · (?:now|today|\d+[mhd])/);
  await expect(compPanel).toContainText("Holo · Usable");
  await expect(compPanel).toContainText("Good daily comp");
  await expect(compPanel.getByRole("button", { name: "eBay UK", exact: true })).toBeVisible();
  await expect(compPanel.getByRole("button", { name: "Next card", exact: true })).toBeVisible();
  await compPanel.getByRole("button", { name: "Manual sold comps", exact: true }).click();
  await expect(compPanel).toContainText("Step 1 · open sold listings");
  await compPanel.getByRole("button", { name: "Log what you saw", exact: true }).click();
  await expect(compPanel.getByRole("textbox", { name: "Sold price", exact: true })).toBeVisible();
  await compPanel.getByRole("button", { name: "Done", exact: true }).click();
  expect(ledger.compEventTypes).toEqual(["catalog", "source", "verdict", "source", "verdict", "receipt"]);

  // First tap reveals the buying maths; the second commits the ledger entry.
  await page.getByRole("button", { name: "Just bought it" }).click();
  const quickStock = page.locator(".quick-stock-card");
  await expect(quickStock).toBeVisible();
  await expect(quickStock.getByLabel(/^What I paid/)).toHaveValue("25.00");
  await page.getByRole("button", { name: "Add to stock", exact: true }).click();
  await expect.poll(() => ledger.acquired).toBe(true);
  expect(ledger.acquireMutationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(ledger.acquireBody).toMatchObject({
    card: { name: "Gengar", number: "TG06/TG30" },
    grade: "RAW",
    costBasisPence: 2500,
    quantity: 1,
    createListing: false,
  });

  await page.getByRole("button", { name: "Stock", exact: true }).click();
  const stockRow = page.locator(".inventory-workspace .item-row").filter({ hasText: "Gengar" });
  await expect(stockRow).toContainText("Needs listing");
  await stockRow.getByRole("button", { name: "Draft listing" }).click();

  const listingCreator = page.locator(".sell-sheet").filter({
    has: page.getByRole("heading", { name: "Create listing" }),
  });
  await expect(listingCreator.getByLabel(/^Your list price/)).toHaveValue("33.75");
  await listingCreator.getByRole("button", { name: "Create listing" }).click();

  await expect.poll(() => ledger.listingState).toBe("DRAFT");
  expect(ledger.listingBody).toMatchObject({ itemId: "item-fixture-gengar", channel: "EBAY", state: "DRAFT" });
  await expect(page.getByRole("heading", { name: "Listing pack" })).toBeVisible();
  await page.locator(".listing-pack-sheet").getByRole("button", { name: "Close" }).click();

  // Re-enter List through the primary navigation, then sell from the draft row.
  await page.getByRole("button", { name: "List", exact: true }).click();
  const listingRow = page.locator(".listings-workspace .item-row").filter({ hasText: "Gengar" });
  await expect(listingRow).toContainText("draft");
  await listingRow.getByText("More", { exact: true }).click();
  await listingRow.getByRole("button", { name: "Sell", exact: true }).click();

  const saleSheet = page.locator(".sell-sheet").filter({ has: page.getByRole("heading", { name: "Mark sold" }) });
  await expect(saleSheet).toBeVisible();
  await saleSheet.getByLabel("Buyer total").fill("50.00");
  await saleSheet.getByLabel("Fees").fill("0");
  await saleSheet.getByLabel("My postage cost").fill("0");
  await saleSheet.getByRole("button", { name: "Create sale" }).click();

  await expect.poll(() => ledger.sold).toBe(true);
  expect(ledger.saleMutationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(ledger.saleBody).toMatchObject({
    salePricePence: 5000,
    feesPence: 0,
    postagePence: 0,
    quantity: 1,
    listingId: "listing-fixture-gengar",
  });

  // Successful sale submission routes to Profit. The numbers come from the
  // stateful dashboard fixture, not from DOM-side state injection.
  const profitSummary = page.locator(".pnl-summary");
  await expect(profitSummary.locator(".metric").filter({ hasText: "Revenue" })).toContainText("£50.00");
  await expect(profitSummary.locator(".metric").filter({ hasText: "Profit" })).toContainText("£25.00");
  await expect(profitSummary.locator(".metric").filter({ hasText: "Net" })).toContainText("£25.00");
});

class FixtureDealerLedger {
  acquired = false;
  sold = false;
  listingState: "DRAFT" | "SOLD" | null = null;
  acquireMutationId: string | undefined;
  saleMutationId: string | undefined;
  acquireBody: Record<string, unknown> | null = null;
  listingBody: Record<string, unknown> | null = null;
  saleBody: Record<string, unknown> | null = null;
  compEventTypes: string[] = [];

  readonly createdAt = new Date().toISOString();

  inventoryItem(): Record<string, unknown> | null {
    if (!this.acquired) return null;
    return {
      id: "item-fixture-gengar",
      card: CARD,
      grade: "RAW",
      quantity: this.sold ? 0 : 1,
      costBasis: 2500,
      acquiredFrom: "Card fair",
      location: "Trade box",
      condition: "NM",
      graderCert: null,
      status: this.sold ? "SOLD" : "IN_STOCK",
      createdAt: this.createdAt,
      updatedAt: this.createdAt,
      listings: this.listingState ? [this.listing(false)] : [],
      sales: this.sold ? [this.sale()] : [],
      photos: [],
    };
  }

  listing(includeItem: boolean): Record<string, unknown> {
    const item = includeItem ? this.inventoryItem() : null;
    return {
      id: "listing-fixture-gengar",
      itemId: "item-fixture-gengar",
      channel: "EBAY",
      state: this.listingState ?? "DRAFT",
      title: "Gengar TG06/TG30 Lost Origin Trainer Gallery Pokemon Card RAW",
      suggestedPrice: 4499,
      listPrice: 4499,
      externalRef: null,
      externalUrl: null,
      listedAt: null,
      endedAt: this.sold ? this.createdAt : null,
      createdAt: this.createdAt,
      updatedAt: this.createdAt,
      ...(item ? { item: { ...item, listings: [] } } : {}),
    };
  }

  sale() {
    const body = this.saleBody ?? {};
    return {
      id: "sale-fixture-gengar",
      itemId: "item-fixture-gengar",
      channel: String(body.channel ?? "EBAY"),
      salePrice: Number(body.salePricePence ?? 5000),
      fees: Number(body.feesPence ?? 0),
      postage: Number(body.postagePence ?? 0),
      soldAt: String(body.soldAt ?? this.createdAt),
      createdAt: this.createdAt,
    };
  }

  dashboard() {
    const sale = this.sold ? this.sale() : null;
    const revenuePence = sale?.salePrice ?? 0;
    const feesPence = sale?.fees ?? 0;
    const postagePence = sale?.postage ?? 0;
    const profitPence = this.sold ? revenuePence - feesPence - postagePence - 2500 : 0;
    const saleSummary = sale ? {
      id: sale.id,
      itemId: sale.itemId,
      name: CARD.name,
      grade: "RAW",
      channel: sale.channel,
      salePricePence: revenuePence,
      feesPence,
      postagePence,
      costBasisPence: 2500,
      profitPence,
      marginPct: revenuePence ? Math.round((profitPence / revenuePence) * 100) : null,
      soldAt: sale.soldAt,
    } : null;
    const channelBreakdown = saleSummary ? [{
      channel: saleSummary.channel,
      saleCount: 1,
      revenuePence,
      feesPence,
      postagePence,
      costPence: 2500,
      profitPence,
      averageSalePence: revenuePence,
      averageProfitPence: profitPence,
      marginPct: saleSummary.marginPct,
    }] : [];

    return {
      metrics: {
        stockCount: this.acquired && !this.sold ? 1 : 0,
        listedCount: 0,
        soldCount: this.sold ? 1 : 0,
        reservedCount: 0,
        activeCostPence: this.acquired && !this.sold ? 2500 : 0,
        soldCostPence: this.sold ? 2500 : 0,
        realizedRevenuePence: revenuePence,
        realizedFeesPence: feesPence,
        realizedPostagePence: postagePence,
        realizedProfitPence: profitPence,
        operatingExpensePence: 0,
        netProfitPence: profitPence,
        cashInPence: revenuePence,
        cashOutPence: this.acquired ? 2500 : 0,
        cashNetPence: revenuePence - (this.acquired ? 2500 : 0),
        cashRecoveryPct: this.acquired ? Math.round((revenuePence / 2500) * 100) : 0,
        realizedMarginPct: saleSummary?.marginPct ?? null,
        sellThroughPct: this.sold ? 100 : 0,
        averageAgeDays: 0,
        agedStockCount: 0,
        channelBreakdown,
        bestSale: saleSummary,
        worstSale: saleSummary,
      },
      listingsByState: {
        DRAFT: this.listingState === "DRAFT" ? 1 : 0,
        ACTIVE: 0,
        SOLD: this.listingState === "SOLD" ? 1 : 0,
        ENDED: 0,
      },
      staleStock: [],
      recentSales: saleSummary ? [saleSummary] : [],
      recentExpenses: [],
      monthlyPnl: saleSummary ? [{
        month: saleSummary.soldAt.slice(0, 7),
        saleCount: 1,
        revenuePence,
        feesPence,
        postagePence,
        costBasisPence: 2500,
        profitPence,
        operatingExpensePence: 0,
        netProfitPence: profitPence,
      }] : [],
    };
  }

  compEvents() {
    const asOf = new Date().toISOString();
    const checked = compResult("checked-comps", 4200, 7, asOf);
    const owned = compResult("owned-sales", 4100, 3, asOf);
    const partial = reconciled([checked]);
    const complete = reconciled([checked, owned]);
    const receipt = {
      ...complete,
      catalog: CARD,
      alternatives: [],
      ambiguous: false,
      psaCert: null,
      cardImage: { imageUrl: null, source: "none", listingSafe: false },
      askEvidence: {
        source: "ebay-browse",
        marketplaceId: "EBAY_GB",
        query: "Gengar TG06/TG30",
        asOf,
        count: 0,
        listings: [],
        lowestPence: null,
        undercutPence: null,
        skipped: true,
      },
    };
    const base = { version: 1, lookupId: "lookup-fixture-gengar", emittedAt: asOf };
    const events = [
      { ...base, sequence: 1, type: "catalog", requested: CARD, identity: CARD, grade: "RAW", catalog: CARD, ambiguity: false, sources: [{ name: "checked-comps", live: true }, { name: "owned-sales", live: true }] },
      { ...base, sequence: 2, type: "source", source: { name: "checked-comps", live: true }, status: "priced", latencyMs: 18, completed: 1, total: 2, result: checked, receipt: partial },
      { ...base, sequence: 3, type: "verdict", phase: "provisional", ambiguity: false, pricedSourceCount: 1, receipt: partial },
      { ...base, sequence: 4, type: "source", source: { name: "owned-sales", live: true }, status: "priced", latencyMs: 26, completed: 2, total: 2, result: owned, receipt: complete },
      { ...base, sequence: 5, type: "verdict", phase: "quorum", ambiguity: false, pricedSourceCount: 2, receipt: complete },
      { ...base, sequence: 6, type: "receipt", latencyMs: 31, receipt },
    ];
    this.compEventTypes = events.map((event) => event.type);
    return events;
  }
}

function compResult(source: string, medianPence: number, sampleSize: number, asOf: string) {
  return {
    source,
    card: CARD,
    grade: "RAW",
    currency: "GBP",
    medianPence,
    meanPence: medianPence,
    lowPence: medianPence - 300,
    highPence: medianPence + 300,
    sampleSize,
    windowDays: 90,
    trendPct: null,
    outliersRemoved: 1,
    asOf,
  };
}

function reconciled(all: ReturnType<typeof compResult>[]) {
  return {
    headline: all[0],
    all,
    sourcesDisagree: false,
    reconciliation: {
      headlinePence: all[0]?.medianPence ?? null,
      confidence: all.length > 1 ? "high" : "medium",
      manualCheck: false,
      reasons: [],
      chosenSource: all[0]?.source ?? null,
      trendPct: null,
    },
  };
}

async function mockDealerApis(context: BrowserContext, ledger: FixtureDealerLedger, options: { criticalDelayMs?: number } = {}) {
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (method === "GET" && options.criticalDelayMs && ["/api/inventory", "/api/listings", "/api/dashboard"].includes(url.pathname)) {
      await new Promise((resolve) => setTimeout(resolve, options.criticalDelayMs));
    }

    if (url.pathname === "/api/comps/stream") {
      const events = ledger.compEvents();
      return route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        headers: { "Cache-Control": "no-store" },
        body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      });
    }

    if (url.pathname === "/api/inventory/acquire" && method === "POST") {
      ledger.acquireMutationId = request.headers()["x-poke-deal-mutation-id"];
      ledger.acquireBody = request.postDataJSON() as Record<string, unknown>;
      ledger.acquired = true;
      return json({
        item: ledger.inventoryItem(),
        suggestion: { pricePence: 4499, rationale: "fixture market price" },
        listing: null,
        catalog: CARD,
      }, 201);
    }

    if (url.pathname === "/api/listings" && method === "POST") {
      ledger.listingBody = request.postDataJSON() as Record<string, unknown>;
      ledger.listingState = "DRAFT";
      return json({ listing: ledger.listing(true) }, 201);
    }

    if (url.pathname === "/api/inventory/item-fixture-gengar/sell" && method === "POST") {
      ledger.saleMutationId = request.headers()["x-poke-deal-mutation-id"];
      ledger.saleBody = request.postDataJSON() as Record<string, unknown>;
      ledger.sold = true;
      ledger.listingState = "SOLD";
      const sale = ledger.sale();
      const profitPence = sale.salePrice - sale.fees - sale.postage - 2500;
      return json({
        item: ledger.inventoryItem(),
        sale,
        sales: [sale],
        salePlan: { soldQuantity: 1, remainingQuantity: 0, status: "SOLD", closeOpenListings: true },
        profitPence,
        quantitySold: 1,
      }, 201);
    }

    if (url.pathname === "/api/inventory") return json({ items: ledger.inventoryItem() ? [ledger.inventoryItem()] : [] });
    if (url.pathname === "/api/listings") return json({ listings: ledger.listingState ? [ledger.listing(true)] : [] });
    if (url.pathname === "/api/dashboard") return json(ledger.dashboard());
    if (url.pathname === "/api/snapshots/portfolio") return json({ points: [], latest: null, previous: null, changePence: null, changePct: null });
    if (url.pathname === "/api/watches") return json({ watches: [] });
    if (url.pathname === "/api/alerts/inbox") return json({ alerts: [], unreadCount: 0 });
    if (url.pathname === "/api/expenses") return json({ expenses: [] });
    if (url.pathname === "/api/system/status") return json({
      sources: [],
      summary: { livePrimaryComps: true, secondaryCrossCheck: true, alertDelivery: false, storedSales: ledger.sold },
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
    if (/^\/api\/cards\/[^/]+\/price-history$/.test(url.pathname)) return json({ snapshots: [], comps: [], listings: [], costBasisPence: 2500, sales: [] });
    return json({});
  });
}
