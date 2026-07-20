import { expect, test, type BrowserContext } from "playwright/test";

const CARD = {
  id: "card-fixture-norman",
  tcgApiId: "sv4-237",
  name: "Norman",
  setName: "Paradox Rift",
  setCode: "sv4",
  number: "237/182",
  imageUrl: "https://images.example.test/norman.jpg",
  displayImageUrl: "https://images.example.test/norman.jpg",
  game: "POKEMON",
  language: "EN",
};

const RAYQUAZA = {
  ...CARD,
  id: "card-fixture-rayquaza",
  tcgApiId: "swsh7-218",
  name: "Rayquaza VMAX",
  setName: "Evolving Skies",
  setCode: "swsh7",
  number: "218/203",
};

test("old no-cost stock keeps purchase cost, market guidance and user list price separate", async ({ context, page }) => {
  const ledger = new PricingLedger();
  await mockPricingApis(context, ledger);

  await page.goto("/?view=stock");
  await page.getByRole("button", { name: /All 1/ }).click();

  const stockRow = page.locator(".inventory-workspace .item-row").filter({ hasText: "Norman" });
  await expect(stockRow).toContainText("Paid £0.01");
  await expect(stockRow).toContainText("£5.00");

  await stockRow.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: /Edit stock details/ }).click();
  const stockEditor = page.locator(".sell-sheet").filter({ has: page.getByRole("heading", { name: "Edit stock" }) });
  await expect(stockEditor.getByLabel(/^What I paid/)).toHaveValue("0.01");
  await stockEditor.getByRole("button", { name: "No tracked cost · £0.00" }).click();
  await expect(stockEditor.getByLabel(/^What I paid/)).toHaveValue("0.00");
  await stockEditor.getByRole("button", { name: "Save stock" }).click();

  await expect.poll(() => ledger.inventoryPatches.at(-1)?.costBasisPence).toBe(0);
  expect(ledger.listPricePence).toBe(500);

  const refreshedRow = page.locator(".inventory-workspace .item-row").filter({ hasText: "Norman" });
  await refreshedRow.getByRole("button", { name: "Price card" }).click();

  const compPanel = page.locator(".comp-panel");
  await expect(compPanel.getByText("Market comp", { exact: true })).toBeVisible();
  const repriceCard = page.locator(".stock-reprice-card");
  await expect(repriceCard).toContainText("Your list price £5.00");
  await expect(repriceCard).toContainText("suggested list price £4.00");
  await expect(repriceCard.getByRole("button", { name: "Keep current" })).toBeVisible();
  await expect(repriceCard.getByRole("button", { name: "Use suggestion" })).toBeVisible();
  await expect(repriceCard.getByRole("button", { name: "Enter another" })).toBeVisible();

  // A refreshed automatic comp is guidance only. No listing write happens
  // until the user explicitly chooses a price action.
  expect(ledger.listingPatches).toHaveLength(0);
  expect(ledger.listPricePence).toBe(500);

  await page.getByRole("button", { name: "Manual sold comps", exact: true }).click();
  const manualCompCard = page.locator(".checked-comp-card.priority").first();
  await manualCompCard.getByRole("button", { name: "Log what you saw", exact: true }).click();
  const manualLogSheet = page.locator(".checked-comp-log-sheet");
  await manualLogSheet.getByRole("textbox").first().fill("6.00");
  await manualLogSheet.getByText("Individual sold-item link · needed for trusted evidence").click();
  await manualLogSheet.getByPlaceholder("https://www.ebay.co.uk/itm/…").fill("https://www.ebay.co.uk/itm/157802426654");
  const soldDate = manualLogSheet.getByLabel("Sold date");
  await soldDate.fill("2026-07-01");
  await soldDate.press("Enter");
  await expect.poll(() => ledger.manualCompBodies.length).toBe(0);
  await expect(soldDate).toHaveValue("2026-07-01");
  await manualLogSheet.getByRole("button", { name: "Log price", exact: true }).click();
  await expect.poll(() => ledger.manualCompBodies.length).toBe(1);
  expect(ledger.manualCompBodies[0]).toMatchObject({
    pricePence: 600,
    soldDate: "2026-07-01",
    condition: "NM",
    priceBasis: "DISPLAYED_PRICE",
    sourceUrl: "https://www.ebay.co.uk/itm/157802426654",
  });
  expect(ledger.listingPatches).toHaveLength(0);
  expect(ledger.listPricePence).toBe(500);
  await expect(page.locator(".progress-source-rail")).toHaveCount(0);

  const loggedEntry = page.locator(".checked-comp-entry-row").filter({ hasText: "£6.00" }).first();
  await loggedEntry.getByRole("button", { name: "Void wrong entry" }).click();
  await loggedEntry.getByLabel("Why is this entry wrong?").fill("Wrong condition selected");
  await loggedEntry.getByRole("button", { name: "Confirm void" }).click();
  await expect.poll(() => ledger.voidCompBodies.length).toBe(1);
  expect(ledger.voidCompBodies[0]).toEqual({ reason: "Wrong condition selected" });
  await expect(loggedEntry).toContainText("Voided: Wrong condition selected");

  await page.getByRole("button", { name: "List", exact: true }).click();
  const listingRow = page.locator(".listings-workspace .item-row").filter({ hasText: "Norman" });
  await listingRow.getByRole("button", { name: "Edit price", exact: true }).click();
  const listingEditor = page.locator(".sell-sheet").filter({
    has: page.getByRole("heading", { name: /Edit (your )?list price/i }),
  });
  await expect(listingEditor.getByLabel(/^Your list price/)).toHaveValue("5.00");
  await expect(listingEditor).toContainText("Comps are guidance, not a gate");
  await listingEditor.getByLabel(/^Your list price/).fill("6.25");
  await listingEditor.getByRole("button", { name: "Save listing" }).click();

  await expect.poll(() => ledger.listPricePence).toBe(625);
  expect(ledger.listingPatches.at(-1)).toMatchObject({ listPricePence: 625 });
  expect(ledger.costBasisPence).toBe(0);
});

test("buy flow names what the dealer paid separately from suggested and chosen sell prices", async ({ context, page }) => {
  const ledger = new PricingLedger();
  await mockPricingApis(context, ledger);

  await page.goto("/?view=buy");
  await page.getByLabel("Smart comp search").fill("Norman Paradox Rift 237/182 RAW");
  await page.getByRole("button", { name: "Comp current card" }).click();

  const compPanel = page.locator(".comp-panel");
  await expect(compPanel.getByText("Market comp", { exact: true })).toBeVisible();
  await expect(compPanel.getByText("Suggested maximum buy", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Just bought it" }).click();

  const stockCard = page.locator(".quick-stock-card");
  await expect(stockCard.getByLabel(/^What I paid/)).toBeVisible();
  await expect(stockCard).toContainText("Your purchase cost—not the market comp or listing price.");
  await stockCard.getByRole("button", { name: "No tracked cost · £0.00" }).click();
  await stockCard.getByText("Change listing plan", { exact: true }).click();
  await expect(stockCard.getByLabel(/^Your list price/)).toBeVisible();
  await stockCard.getByLabel(/^Your list price/).fill("5.00");
  await stockCard.getByRole("button", { name: "eBay draft", exact: true }).click();
  await page.getByRole("button", { name: "Add to stock", exact: true }).click();

  await expect.poll(() => ledger.acquireBody).not.toBeNull();
  expect(ledger.acquireBody).toMatchObject({
    costBasisPence: 0,
    listPricePence: 500,
    createListing: true,
  });
});

test("high-value Rayquaza disagreement shows the traceable UK range and never auto-offers", async ({ context, page }) => {
  const ledger = new RayquazaPricingLedger();
  await mockPricingApis(context, ledger);

  await page.goto("/?view=buy");
  await page.getByLabel("Smart comp search").fill("Rayquaza VMAX Evolving Skies 218/203 RAW NM");
  await page.getByRole("button", { name: "Comp current card" }).click();

  const compPanel = page.locator(".comp-panel");
  await expect(compPanel.getByRole("heading", { name: "No auto-offer" })).toBeVisible();
  await expect(compPanel.getByText("eBay UK sold range", { exact: true })).toBeVisible();
  await expect(compPanel.getByText("£450.00–£750.00", { exact: true })).toBeVisible();
  await expect(compPanel.getByText(/3 traceable UK solds/).first()).toBeVisible();

  await page.getByRole("button", { name: "Just bought it" }).click();
  const stockCard = page.locator(".quick-stock-card");
  await stockCard.getByLabel(/^What I paid/).fill("500.00");
  await expect(stockCard.getByText("Suggested list price", { exact: true }).locator("..")).toContainText("£550.00");
  await expect(stockCard).not.toContainText("Suggested list price £1039.81");
  await stockCard.getByText("Change listing plan", { exact: true }).click();
  await stockCard.getByRole("button", { name: "Stock only", exact: true }).click();
  await stockCard.getByRole("button", { name: "Confirm stock", exact: true }).click();

  await expect.poll(() => ledger.acquireBody).not.toBeNull();
  expect(ledger.acquireBody?.reviewedComps).toMatchObject({ manualCheck: true });
  expect(ledger.acquireBody).not.toHaveProperty("listPricePence");
});

test("one traceable Rayquaza sale leads the UI without becoming an automatic comp", async ({ context, page }) => {
  const ledger = new RayquazaThinPricingLedger();
  await mockPricingApis(context, ledger);
  await context.route("https://www.ebay.co.uk/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>eBay UK solds</title>" }));
  await page.setViewportSize({ width: 320, height: 800 });

  await page.goto("/?view=buy");
  await page.getByLabel("Smart comp search").fill("Rayquaza VMAX Evolving Skies 218/203 RAW NM");
  await page.getByRole("button", { name: "Comp current card" }).click();

  const compPanel = page.locator(".comp-panel");
  await expect(compPanel.getByRole("heading", { name: "No auto-offer" })).toBeVisible();
  await expect(compPanel.getByText("eBay UK reference", { exact: true })).toBeVisible();
  await expect(compPanel.getByText("£660.80", { exact: true }).first()).toBeVisible();
  await expect(compPanel.getByText(/provider £1039\.81 unverified/)).toBeVisible();

  const ebayPagePromise = context.waitForEvent("page");
  await compPanel.getByRole("button", { name: "eBay UK", exact: true }).click();
  const ebayPage = await ebayPagePromise;
  await ebayPage.close();
  await page.getByRole("button", { name: "Manual sold comps", exact: true }).click();
  const manualCompCard = page.locator(".checked-comp-card.priority").first();
  await expect(manualCompCard).toContainText("1 traceable UK sold · median £660.80");
  await expect(manualCompCard.getByRole("button", { name: /Use comp/ })).toHaveCount(0);
  await expect(manualCompCard).toContainText("One logged comp is shown as corroboration");
  await manualCompCard.getByText("Individual sold-item link · needed for trusted evidence").click();
  await expect(manualCompCard.getByPlaceholder("https://www.ebay.co.uk/itm/…")).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("checked-comp logger keeps the eBay loop open and promotes the second qualified sold", async ({ context, page }) => {
  const ledger = new EvidenceThroughputPricingLedger();
  await mockPricingApis(context, ledger);
  await page.setViewportSize({ width: 320, height: 800 });

  await page.goto("/?view=buy");
  await page.getByLabel("Smart comp search").fill("Rayquaza VMAX Evolving Skies 218/203 RAW NM");
  await page.getByRole("button", { name: "Comp current card" }).click();
  await page.getByRole("button", { name: "Manual sold comps", exact: true }).click();

  const compPanel = page.locator(".comp-panel");
  const manualCompCard = page.locator(".checked-comp-card.priority").first();
  await manualCompCard.getByRole("button", { name: "Log what you saw", exact: true }).click();
  await expect(manualCompCard.getByRole("link", { name: "Open eBay UK sold search", exact: true })).toBeVisible();
  await expect(manualCompCard.getByText("0 of 2 qualified solds — add two to headline", { exact: true })).toBeVisible();

  const logSheet = manualCompCard.locator(".checked-comp-log-sheet");
  const soldPrice = logSheet.getByRole("textbox", { name: "Sold price", exact: true });
  const soldDate = logSheet.getByLabel("Sold date");
  await logSheet.getByText("Individual sold-item link · needed for trusted evidence").click();
  const soldUrl = logSheet.getByPlaceholder("https://www.ebay.co.uk/itm/…");

  await soldPrice.fill("450.00");
  await soldDate.fill("2026-07-18");
  await soldUrl.fill("https://www.ebay.co.uk/itm/257584212141");
  await logSheet.getByRole("button", { name: "Log price", exact: true }).click();

  await expect.poll(() => ledger.manualCompBodies.length).toBe(1);
  await expect(manualCompCard.getByText("1 of 2 qualified solds — add one more to headline", { exact: true })).toBeVisible();
  await expect(soldDate).toHaveValue("2026-07-18");
  await expect(soldPrice).toBeFocused();

  await soldPrice.fill("750.00");
  await soldUrl.fill("https://www.ebay.co.uk/itm/358710939479");
  await logSheet.getByRole("button", { name: "Log price", exact: true }).click();

  await expect.poll(() => ledger.manualCompBodies.length).toBe(2);
  await expect(manualCompCard.getByText("2 of 2 qualified solds — range can headline if spread checks pass", { exact: true })).toBeVisible();
  await expect(compPanel.getByText("eBay UK sold range", { exact: true })).toBeVisible();
  await expect(compPanel.getByText("£450.00–£750.00", { exact: true })).toBeVisible();
  await expect(soldDate).toHaveValue("2026-07-18");
  await expect(soldPrice).toBeFocused();

  await soldPrice.fill("451.00");
  await soldUrl.fill("https://www.ebay.co.uk/itm/Rayquaza-VMAX/257584212141?mkcid=1");
  await logSheet.getByRole("button", { name: "Log price", exact: true }).click();

  const duplicate = logSheet.locator(".checked-comp-duplicate");
  await expect(duplicate).toContainText("£450.00");
  await expect(duplicate).toContainText("used");
  await expect(duplicate.getByRole("button", { name: "Void existing entry" })).toBeVisible();
  await expect(duplicate.getByRole("button", { name: "Skip duplicate" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

class PricingLedger {
  costBasisPence = 1;
  listPricePence = 500;
  inventoryPatches: Array<Record<string, unknown>> = [];
  listingPatches: Array<Record<string, unknown>> = [];
  manualCompBodies: Array<Record<string, unknown>> = [];
  voidCompBodies: Array<Record<string, unknown>> = [];
  acquireBody: Record<string, unknown> | null = null;
  readonly createdAt = "2026-05-01T10:00:00.000Z";

  listing(includeItem = true): Record<string, unknown> {
    return {
      id: "listing-fixture-norman",
      itemId: "item-fixture-norman",
      channel: "EBAY",
      state: "DRAFT",
      title: "Norman 237/182 Paradox Rift Pokemon Card RAW",
      suggestedPrice: 1,
      listPrice: this.listPricePence,
      externalRef: "offer:201067726011",
      externalUrl: null,
      offerSyncedAt: "2026-05-01T10:00:00.000Z",
      offerSyncedPrice: 1,
      listedAt: null,
      endedAt: null,
      createdAt: this.createdAt,
      updatedAt: this.createdAt,
      ...(includeItem ? { item: this.item(false) } : {}),
    };
  }

  item(includeListings = true): Record<string, unknown> {
    return {
      id: "item-fixture-norman",
      card: CARD,
      grade: "RAW",
      quantity: 1,
      costBasis: this.costBasisPence,
      acquiredFrom: "Old collection",
      location: "Trade box",
      condition: "NM",
      graderCert: null,
      status: "IN_STOCK",
      createdAt: this.createdAt,
      updatedAt: this.createdAt,
      listings: includeListings ? [this.listing(false)] : [],
      sales: [],
      photos: [{ id: "photo-norman", url: "https://images.example.test/norman-real.jpg", origin: "REAL", order: 0, createdAt: this.createdAt }],
    };
  }

  compEvents() {
    const asOf = "2026-07-13T20:00:00.000Z";
    const result = {
      source: "checked-comps",
      card: CARD,
      grade: "RAW",
      currency: "GBP",
      medianPence: 400,
      meanPence: 400,
      lowPence: 350,
      highPence: 450,
      sampleSize: 8,
      windowDays: 90,
      trendPct: null,
      outliersRemoved: 1,
      asOf,
    };
    const receipt = {
      headline: result,
      all: [result],
      sourcesDisagree: false,
      reconciliation: {
        headlinePence: 400,
        confidence: "high",
        manualCheck: false,
        reasons: [],
        chosenSource: result.source,
        trendPct: null,
      },
      catalog: CARD,
      alternatives: [],
      ambiguous: false,
      psaCert: null,
      cardImage: { imageUrl: CARD.imageUrl, source: "catalog", listingSafe: true },
      askEvidence: {
        source: "ebay-browse",
        marketplaceId: "EBAY_GB",
        query: "Norman 237/182",
        asOf,
        count: 0,
        listings: [],
        lowestPence: null,
        undercutPence: null,
        skipped: true,
      },
    };
    const base = { version: 1, lookupId: "lookup-fixture-norman", emittedAt: asOf };
    return [
      { ...base, sequence: 1, type: "catalog", requested: CARD, identity: CARD, grade: "RAW", catalog: CARD, ambiguity: false, sources: [{ name: result.source, live: true }] },
      { ...base, sequence: 2, type: "source", source: { name: result.source, live: true }, status: "priced", latencyMs: 10, completed: 1, total: 1, result, receipt },
      { ...base, sequence: 3, type: "verdict", phase: "quorum", ambiguity: false, pricedSourceCount: 1, receipt },
      { ...base, sequence: 4, type: "receipt", latencyMs: 12, receipt },
    ];
  }
}

class RayquazaPricingLedger extends PricingLedger {
  override compEvents() {
    const asOf = "2026-07-18T20:00:00.000Z";
    const checked = {
      source: "checked-comps",
      card: RAYQUAZA,
      grade: "RAW",
      currency: "GBP",
      medianPence: 60_000,
      meanPence: 60_000,
      lowPence: 45_000,
      highPence: 75_000,
      sampleSize: 3,
      windowDays: 90,
      trendPct: null,
      outliersRemoved: 0,
      asOf,
      raw: { kind: "checked-comps", region: "UK", condition: "NM", conditionMatched: true, traceableCount: 3 },
    };
    const poketrace = {
      ...checked,
      source: "poketrace",
      medianPence: 103_981,
      meanPence: 103_981,
      lowPence: 103_981,
      highPence: 103_981,
      sampleSize: 64,
      raw: { kind: "sold-aggregate", market: "US", priceSource: "ebay", approxSaleCount: true },
    };
    const receipt = {
      headline: checked,
      all: [checked, poketrace],
      sourcesDisagree: true,
      reconciliation: {
        headlinePence: 60_000,
        confidence: "low",
        manualCheck: true,
        reasons: ["approximate-sample-capped:64-to-50:poketrace", "uk-solds-disagree"],
        chosenSource: "checked-comps",
        trendPct: null,
        selection: {
          sourceTier: 0.9,
          region: "UK",
          sampleSize: 3,
          ageDays: 1,
          corroboratingCount: 0,
          appliedPenalties: [],
          spreadPence: 43_981,
          spreadPct: 73.3,
          lowPence: 45_000,
          highPence: 75_000,
          crossSourceLowPence: 60_000,
          crossSourceHighPence: 103_981,
          chosenBecause: "UK checked comps · 3 samples · 1d old · best eligible evidence",
        },
      },
      catalog: RAYQUAZA,
      alternatives: [],
      ambiguous: false,
      psaCert: null,
      cardImage: { imageUrl: RAYQUAZA.imageUrl, source: "catalog", listingSafe: true },
    };
    const base = { version: 1, lookupId: "lookup-fixture-rayquaza", emittedAt: asOf };
    return [
      { ...base, sequence: 1, type: "catalog", requested: RAYQUAZA, identity: RAYQUAZA, grade: "RAW", catalog: RAYQUAZA, ambiguity: false, sources: [{ name: checked.source, live: true }, { name: poketrace.source, live: true }] },
      { ...base, sequence: 2, type: "source", source: { name: checked.source, live: true }, status: "priced", latencyMs: 10, completed: 1, total: 2, result: checked, receipt },
      { ...base, sequence: 3, type: "source", source: { name: poketrace.source, live: true }, status: "priced", latencyMs: 12, completed: 2, total: 2, result: poketrace, receipt },
      { ...base, sequence: 4, type: "receipt", latencyMs: 14, receipt },
    ];
  }
}

class RayquazaThinPricingLedger extends PricingLedger {
  override compEvents() {
    const asOf = "2026-07-18T20:00:00.000Z";
    const entry = {
      id: "rayquaza-checked-1",
      cardId: RAYQUAZA.id,
      grade: "RAW",
      pricePence: 66_080,
      soldDate: "2026-07-01T12:00:00.000Z",
      platform: "ebay-uk",
      condition: "NM",
      priceBasis: "DISPLAYED_PRICE",
      sourceUrl: "https://www.ebay.co.uk/itm/257584212141",
      sourceListingId: "ebay-uk:257584212141",
      traceable: true,
      evidenceStatus: "used",
      createdAt: "2026-07-19T12:00:00.000Z",
    };
    const checked = {
      source: "checked-comps",
      card: RAYQUAZA,
      grade: "RAW",
      currency: "GBP",
      medianPence: 66_080,
      meanPence: 66_080,
      lowPence: 66_080,
      highPence: 66_080,
      sampleSize: 1,
      windowDays: 90,
      trendPct: null,
      outliersRemoved: 0,
      asOf: entry.soldDate,
      raw: { kind: "checked-comps", region: "UK", condition: "NM", conditionMatched: true, traceableCount: 1, entries: [entry] },
    };
    const poketrace = {
      ...checked,
      source: "poketrace",
      medianPence: 103_981,
      meanPence: 103_981,
      lowPence: 103_981,
      highPence: 103_981,
      sampleSize: 64,
      asOf,
      raw: { kind: "sold-aggregate", market: "US", priceSource: "ebay", approxSaleCount: true },
    };
    const receipt = {
      headline: poketrace,
      all: [checked, poketrace],
      sourcesDisagree: true,
      reconciliation: {
        headlinePence: 103_981,
        confidence: "medium",
        manualCheck: true,
        reasons: ["corroboration-thin-checked-comps", "high-value-without-uk-solds"],
        chosenSource: "poketrace",
        trendPct: null,
        selection: {
          sourceTier: 0.6,
          region: "US",
          sampleSize: 50,
          ageDays: 1,
          corroboratingCount: 0,
          appliedPenalties: [],
          spreadPence: 0,
          spreadPct: 0,
          lowPence: 103_981,
          highPence: 103_981,
          crossSourceLowPence: 103_981,
          crossSourceHighPence: 103_981,
          chosenBecause: "US PokeTrace · 50 weighted samples · 1d old · best eligible evidence",
        },
      },
      catalog: RAYQUAZA,
      alternatives: [],
      ambiguous: false,
      psaCert: null,
      cardImage: { imageUrl: RAYQUAZA.imageUrl, source: "catalog", listingSafe: true },
    };
    const base = { version: 1, lookupId: "lookup-fixture-rayquaza-thin", emittedAt: asOf };
    return [
      { ...base, sequence: 1, type: "catalog", requested: RAYQUAZA, identity: RAYQUAZA, grade: "RAW", catalog: RAYQUAZA, ambiguity: false, sources: [{ name: checked.source, live: true }, { name: poketrace.source, live: true }] },
      { ...base, sequence: 2, type: "source", source: { name: checked.source, live: true }, status: "priced", latencyMs: 10, completed: 1, total: 2, result: checked, receipt },
      { ...base, sequence: 3, type: "source", source: { name: poketrace.source, live: true }, status: "priced", latencyMs: 12, completed: 2, total: 2, result: poketrace, receipt },
      { ...base, sequence: 4, type: "receipt", latencyMs: 14, receipt },
    ];
  }
}

class EvidenceThroughputPricingLedger extends PricingLedger {
  private readonly checkedEntries: Array<Record<string, unknown>> = [];

  override compEvents() {
    const receipt = this.currentCompResponse();
    const provider = receipt.headline;
    const asOf = String(provider.asOf);
    const base = { version: 1, lookupId: "lookup-fixture-rayquaza-throughput", emittedAt: asOf };
    return [
      { ...base, sequence: 1, type: "catalog", requested: RAYQUAZA, identity: RAYQUAZA, grade: "RAW", catalog: RAYQUAZA, ambiguity: false, sources: [{ name: provider.source, live: true }] },
      { ...base, sequence: 2, type: "source", source: { name: provider.source, live: true }, status: "priced", latencyMs: 10, completed: 1, total: 1, result: provider, receipt },
      { ...base, sequence: 3, type: "receipt", latencyMs: 12, receipt },
    ];
  }

  logCheckedComp(body: Record<string, unknown>): { body: Record<string, unknown>; status: number } {
    const itemId = String(body.sourceUrl ?? "").match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/)?.[1] ?? "";
    const sourceListingId = itemId ? `ebay-uk:${itemId}` : null;
    if (sourceListingId && this.checkedEntries.some((entry) => entry.sourceListingId === sourceListingId)) {
      return {
        status: 409,
        body: {
          error: "That sold listing is already logged. Each active eBay item can back the comp only once. If the existing entry is wrong, void it first, then log corrected evidence.",
          code: "duplicate-listing",
        },
      };
    }

    const entry = {
      id: `rayquaza-throughput-${this.checkedEntries.length + 1}`,
      cardId: RAYQUAZA.id,
      grade: "RAW",
      pricePence: Number(body.pricePence),
      soldDate: String(body.soldDate),
      platform: "ebay-uk",
      condition: "NM",
      priceBasis: "DISPLAYED_PRICE",
      sourceUrl: `https://www.ebay.co.uk/itm/${itemId}`,
      sourceListingId,
      traceable: true,
      evidenceStatus: "used",
      createdAt: `2026-07-20T10:0${this.checkedEntries.length}:00.000Z`,
    };
    this.checkedEntries.push(entry);
    return {
      status: 201,
      body: { entry, entries: [...this.checkedEntries], aggregate: this.checkedAggregate() },
    };
  }

  currentCompResponse() {
    const provider = {
      source: "poketrace",
      card: RAYQUAZA,
      grade: "RAW",
      currency: "GBP",
      medianPence: 103_981,
      meanPence: 103_981,
      lowPence: 103_981,
      highPence: 103_981,
      sampleSize: 64,
      windowDays: 90,
      trendPct: null,
      outliersRemoved: 0,
      asOf: "2026-07-19T20:00:00.000Z",
      raw: { kind: "sold-aggregate", market: "US", priceSource: "ebay", approxSaleCount: true },
    };
    const checked = this.checkedEntries.length > 0 ? this.checkedAggregate() : null;
    const checkedCanHeadline = this.checkedEntries.length >= 2;
    const headline = checkedCanHeadline ? checked! : provider;
    return {
      headline,
      all: checked ? [checked, provider] : [provider],
      sourcesDisagree: Boolean(checked),
      reconciliation: {
        headlinePence: headline.medianPence,
        confidence: "low",
        manualCheck: true,
        reasons: checkedCanHeadline ? ["uk-solds-disagree", "low-confidence-headline"] : ["high-value-without-uk-solds"],
        chosenSource: headline.source,
        trendPct: null,
      },
      catalog: RAYQUAZA,
      alternatives: [],
      ambiguous: false,
      psaCert: null,
      cardImage: { imageUrl: RAYQUAZA.imageUrl, source: "catalog", listingSafe: true },
    };
  }

  private checkedAggregate() {
    const prices = this.checkedEntries.map((entry) => Number(entry.pricePence)).sort((a, b) => a - b);
    const medianPence = prices.length % 2
      ? prices[Math.floor(prices.length / 2)]!
      : Math.round((prices[prices.length / 2 - 1]! + prices[prices.length / 2]!) / 2);
    return {
      source: "checked-comps",
      card: RAYQUAZA,
      grade: "RAW",
      currency: "GBP",
      medianPence,
      meanPence: Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length),
      lowPence: Math.min(...prices),
      highPence: Math.max(...prices),
      sampleSize: prices.length,
      windowDays: 90,
      trendPct: null,
      outliersRemoved: 0,
      asOf: String(this.checkedEntries.at(-1)?.soldDate),
      raw: {
        kind: "checked-comps",
        region: "UK",
        condition: "NM",
        conditionMatched: true,
        traceableCount: prices.length,
        grossSpread: Math.max(...prices) / Math.min(...prices),
        entries: [...this.checkedEntries],
      },
    };
  }
}

async function mockPricingApis(context: BrowserContext, ledger: PricingLedger) {
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (url.pathname === "/api/comps/stream") {
      const events = ledger.compEvents();
      return route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        headers: { "Cache-Control": "no-store" },
        body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      });
    }

    if (url.pathname === "/api/comps" && method === "GET" && ledger instanceof EvidenceThroughputPricingLedger) {
      return json(ledger.currentCompResponse());
    }

    if (url.pathname === "/api/inventory/item-fixture-norman" && method === "PATCH") {
      const patch = request.postDataJSON() as Record<string, unknown>;
      ledger.inventoryPatches.push(patch);
      ledger.costBasisPence = Number(patch.costBasisPence);
      return json({ item: ledger.item() });
    }

    if (url.pathname === "/api/listings/listing-fixture-norman" && method === "PATCH") {
      const patch = request.postDataJSON() as Record<string, unknown>;
      ledger.listingPatches.push(patch);
      if (typeof patch.listPricePence === "number") ledger.listPricePence = patch.listPricePence;
      return json({ listing: ledger.listing() });
    }

    if (url.pathname === "/api/inventory/acquire" && method === "POST") {
      ledger.acquireBody = request.postDataJSON() as Record<string, unknown>;
      return json({
        item: ledger.item(),
        suggestion: { pricePence: 400, rationale: "fixture market price" },
        listing: ledger.acquireBody.createListing ? ledger.listing() : null,
        catalog: CARD,
      }, 201);
    }

    if (url.pathname === "/api/checked-comps" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      ledger.manualCompBodies.push(body);
      if (ledger instanceof EvidenceThroughputPricingLedger) {
        const response = ledger.logCheckedComp(body);
        return json(response.body, response.status);
      }
      const entry = {
        id: "manual-comp-norman-1",
        cardId: CARD.id,
        grade: "RAW",
        pricePence: Number(body.pricePence),
        soldDate: String(body.soldDate),
        platform: String(body.platform),
        condition: body.condition,
        priceBasis: body.priceBasis,
        note: body.note ?? null,
        sourceUrl: body.sourceUrl ?? null,
        sourceListingId: "ebay-uk:157802426654",
        traceable: true,
        evidenceStatus: "used",
        createdAt: "2026-07-13T20:05:00.000Z",
      };
      return json({
        entry,
        entries: [entry],
        aggregate: {
          source: "checked-comps",
          card: CARD,
          grade: "RAW",
          currency: "GBP",
          medianPence: 600,
          meanPence: 600,
          lowPence: 600,
          highPence: 600,
          sampleSize: 1,
          windowDays: 90,
          trendPct: null,
          outliersRemoved: 0,
          asOf: "2026-07-13T20:05:00.000Z",
          raw: { kind: "checked-comps", region: "UK", condition: "NM", conditionMatched: true, traceableCount: 1, grossSpread: 1, entries: [entry] },
        },
      }, 201);
    }

    if (url.pathname === "/api/checked-comps/manual-comp-norman-1" && method === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      ledger.voidCompBodies.push(body);
      const entry = {
        id: "manual-comp-norman-1",
        cardId: CARD.id,
        grade: "RAW",
        pricePence: 600,
        soldDate: "2026-07-01",
        platform: "ebay-uk",
        condition: "NM",
        priceBasis: "DISPLAYED_PRICE",
        sourceUrl: "https://www.ebay.co.uk/itm/157802426654",
        sourceListingId: "ebay-uk:157802426654",
        traceable: false,
        evidenceStatus: "corroboration",
        exclusionReasons: ["voided"],
        voidedAt: "2026-07-13T20:06:00.000Z",
        voidReason: String(body.reason),
        createdAt: "2026-07-13T20:05:00.000Z",
      };
      return json({
        entry,
        entries: [entry],
        aggregate: {
          source: "checked-comps",
          card: CARD,
          grade: "RAW",
          currency: "GBP",
          medianPence: 0,
          meanPence: 0,
          lowPence: 0,
          highPence: 0,
          sampleSize: 0,
          windowDays: 90,
          trendPct: null,
          outliersRemoved: 0,
          asOf: "2026-07-13T20:06:00.000Z",
          raw: { kind: "checked-comps", reason: "no traceable condition-matched eBay UK sold listings", entries: [entry] },
        },
      });
    }

    if (url.pathname === "/api/inventory") return json({ items: [ledger.item()] });
    if (url.pathname === "/api/listings") return json({ listings: [ledger.listing()] });
    if (url.pathname === "/api/dashboard") return json({
      metrics: {
        stockCount: 1, listedCount: 0, soldCount: 0, reservedCount: 0,
        activeCostPence: ledger.costBasisPence, soldCostPence: 0,
        realizedRevenuePence: 0, realizedFeesPence: 0, realizedPostagePence: 0,
        realizedProfitPence: 0, operatingExpensePence: 0, netProfitPence: 0,
        cashInPence: 0, cashOutPence: ledger.costBasisPence, cashNetPence: -ledger.costBasisPence,
        cashRecoveryPct: 0, realizedMarginPct: null, sellThroughPct: 0,
        averageAgeDays: 73, agedStockCount: 1, channelBreakdown: [], bestSale: null, worstSale: null,
      },
      listingsByState: { DRAFT: 1, ACTIVE: 0, SOLD: 0, ENDED: 0 },
      staleStock: [], recentSales: [], recentExpenses: [], monthlyPnl: [],
    });
    if (url.pathname === "/api/snapshots/portfolio") return json({ points: [], latest: null, previous: null, changePence: null, changePct: null });
    if (url.pathname === "/api/watches") return json({ watches: [] });
    if (url.pathname === "/api/alerts/inbox") return json({ alerts: [], unreadCount: 0 });
    if (url.pathname === "/api/expenses") return json({ expenses: [] });
    if (url.pathname === "/api/system/status") return json({ sources: [], summary: { livePrimaryComps: true, secondaryCrossCheck: true, alertDelivery: false, storedSales: false } });
    if (url.pathname === "/api/deal-sessions") return json({ session: null, summary: { includedCount: 0, excludedCount: 0, totalMaxCashPence: 0, totalMaxTradePence: 0, totalExpectedProceedsPence: 0, totalExpectedProfitPence: 0, suggestedBundleOfferPence: 0, completionReady: false, completionBlockers: [] } });
    if (url.pathname === "/api/comps/reviews") return json({ reviews: [], nextCursor: null });
    if (url.pathname === "/api/ebay/status") return json({ configured: true, connected: true, tokenSource: "db", locationSetup: { configured: true, missingFields: [], missingRecommendedFields: [] } });
    if (url.pathname === "/api/catalog/sets") return json({ sets: [] });
    if (url.pathname === "/api/catalog/cards") return json({ cards: [] });
    if (url.pathname === "/api/catalog/search") return json({ sets: [] });
    if (/^\/api\/cards\/[^/]+\/price-history$/.test(url.pathname)) return json({ snapshots: [], comps: [], listings: [ledger.listing(false)], costBasisPence: ledger.costBasisPence, sales: [] });
    return json({});
  });
}
