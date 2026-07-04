import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit, type Browser, type BrowserType, type Page } from "playwright";

type Engine = { name: "chromium" | "webkit"; launcher: BrowserType };
type ViewportSpec = { name: string; width: number; height: number; mobile: boolean; scale: number };
type CaptureState = {
  name: string;
  viewports: ViewportSpec[];
  prepare: (page: Page) => Promise<void>;
};

const phase = process.argv[2] ?? "after";
const baseUrl = process.argv[3] ?? "http://localhost:3000";
const outDir = path.join(process.cwd(), "docs/visual-audit/pass2", phase);

const engines: Engine[] = [
  { name: "chromium", launcher: chromium },
  { name: "webkit", launcher: webkit },
];

const phone: ViewportSpec = { name: "390x844", width: 390, height: 844, mobile: true, scale: 3 };
const phoneKeyboard: ViewportSpec = { name: "390x500", width: 390, height: 500, mobile: true, scale: 3 };
const desktop: ViewportSpec = { name: "1440x900", width: 1440, height: 900, mobile: false, scale: 1 };

const cardArt = "https://images.pokemontcg.io/svp/208_hires.png";

await mkdir(outDir, { recursive: true });

const states: CaptureState[] = [
  {
    name: "stack-listing-pack-publish-confirm",
    viewports: [phone, desktop],
    prepare: async (page) => {
      await setupPublishReadyMocks(page);
      await goto(page);
      await clickTab(page, "Listings");
      await clickButton(page, /Open pack|Pack/);
      await scrollSheetToBottom(page, ".listing-pack-sheet");
      await clickButton(page, /Publish to eBay|Publish$/);
      await page.waitForTimeout(350);
    },
  },
  {
    name: "stack-sale-sheet-keyboard",
    viewports: [phoneKeyboard],
    prepare: async (page) => {
      await goto(page);
      await clickTab(page, "Listings");
      await clickButton(page, /Record sale|Sell/);
      await page.waitForTimeout(350);
    },
  },
  {
    name: "stack-edit-sheet-stock-list",
    viewports: [phone, desktop],
    prepare: async (page) => {
      await goto(page);
      await clickTab(page, "Inventory");
      await page.getByText("More").first().click({ timeout: 6000 });
      await page.waitForTimeout(200);
      await clickButton(page, /^Edit$/);
      await page.waitForTimeout(350);
    },
  },
  {
    name: "stack-buy-session-panel",
    viewports: [phone, desktop],
    prepare: async (page) => {
      await goto(page);
      await page.waitForTimeout(350);
    },
  },
  {
    name: "stack-toast-over-sheet",
    viewports: [phone, desktop],
    prepare: async (page) => {
      await setupPublishReadyMocks(page);
      await goto(page);
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseUrl).origin }).catch(() => undefined);
      await clickTab(page, "Listings");
      await clickButton(page, /Open pack|Pack/);
      await clickButton(page, /Copy only|Copy listing pack|Copy \+ open/);
      await page.waitForTimeout(350);
    },
  },
  {
    name: "stack-decision-bar-dropdown",
    viewports: [phone, desktop],
    prepare: async (page) => {
      await setupCompMock(page, "high");
      await goto(page);
      await runComp(page, "Victini SVP 208 RAW");
      await page.getByText("Full grade list").click().catch(() => undefined);
      await page.waitForTimeout(350);
    },
  },
  {
    name: "buy-empty",
    viewports: [phone],
    prepare: async (page) => {
      await goto(page);
      await page.waitForTimeout(350);
    },
  },
  {
    name: "buy-suggestions-open",
    viewports: [phone],
    prepare: async (page) => {
      await setupSuggestionMocks(page);
      await goto(page);
      await page.getByLabel("Smart comp search").fill("Umbreon prismatic");
      await page.waitForTimeout(900);
    },
  },
  {
    name: "buy-comp-loading",
    viewports: [phone],
    prepare: async (page) => {
      await page.route("**/api/comps**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await route.fulfill({ json: compPayload("high") });
      });
      await goto(page);
      await runComp(page, "Victini SVP 208 RAW", { waitForResult: false });
      await page.waitForTimeout(280);
    },
  },
  {
    name: "buy-comp-high",
    viewports: [phone],
    prepare: async (page) => {
      await setupCompMock(page, "high");
      await goto(page);
      await runComp(page, "Victini SVP 208 RAW");
    },
  },
  {
    name: "buy-comp-medium",
    viewports: [phone],
    prepare: async (page) => {
      await setupCompMock(page, "medium");
      await goto(page);
      await runComp(page, "Zapdos 192 151 BGS 9.5");
    },
  },
  {
    name: "buy-comp-low",
    viewports: [phone],
    prepare: async (page) => {
      await setupCompMock(page, "low");
      await goto(page);
      await runComp(page, "Lugia Neo Genesis CGC 1.5");
    },
  },
  {
    name: "buy-ambiguous-alternatives",
    viewports: [phone],
    prepare: async (page) => {
      await setupCompMock(page, "ambiguous");
      await goto(page);
      await runComp(page, "Umbreon Prismatic RAW");
    },
  },
  {
    name: "buy-deal-calc-open",
    viewports: [phone],
    prepare: async (page) => {
      await setupCompMock(page, "high");
      await goto(page);
      await runComp(page, "Victini SVP 208 RAW");
      await page.locator("label", { hasText: "Cost" }).first().locator("input").fill("5");
      await page.waitForTimeout(300);
    },
  },
  {
    name: "buy-uk-asks-block",
    viewports: [phone],
    prepare: async (page) => {
      await setupCompMock(page, "asks");
      await goto(page);
      await runComp(page, "Victini SVP 208 RAW");
    },
  },
  {
    name: "buy-checked-comps-row",
    viewports: [phone],
    prepare: async (page) => {
      await setupCompMock(page, "checked");
      await goto(page);
      await runComp(page, "Victini SVP 208 RAW");
    },
  },
];

for (const engine of engines) {
  const browser = await engine.launcher.launch();
  try {
    for (const state of states) {
      for (const viewport of state.viewports) {
        await captureState(browser, engine.name, state, viewport);
      }
    }
  } finally {
    await browser.close();
  }
}

async function captureState(browser: Browser, engine: Engine["name"], state: CaptureState, viewport: ViewportSpec) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
  });
  const page = await context.newPage();
  try {
    await state.prepare(page);
    await assertNoHorizontalScroll(page);
    const file = `${phase}-${engine}-${viewport.name}-${state.name}.jpg`;
    await page.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 82, fullPage: false });
    console.log(`captured ${file}`);
  } catch (err) {
    console.error(`capture failed ${engine} ${viewport.name} ${state.name}:`, err instanceof Error ? err.message : err);
    const file = `${phase}-${engine}-${viewport.name}-${state.name}-failed.jpg`;
    await page.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 82, fullPage: false }).catch(() => undefined);
  } finally {
    await context.close();
  }
}

async function goto(page: Page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
}

async function clickButton(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name }).first();
  try {
    await button.click({ timeout: 6000 });
  } catch (err) {
    await button.dispatchEvent("click", {}, { timeout: 1000 });
  }
  await page.waitForTimeout(250);
}

async function clickTab(page: Page, label: string) {
  const navButton = page
    .getByRole("navigation", { name: /Primary/i })
    .getByRole("button", { name: new RegExp(label, "i") })
    .first();
  try {
    await navButton.click({ timeout: 6000 });
  } catch (err) {
    await page.getByRole("button", { name: new RegExp(label, "i") }).first().click({ timeout: 6000 });
  }
  await page.waitForTimeout(350);
}

async function runComp(page: Page, text: string, options: { waitForResult?: boolean } = {}) {
  await page.getByLabel("Smart comp search").fill(text);
  await fillManualIdentity(page, identityForText(text));
  await page.locator("form.lookup-panel").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  if (options.waitForResult !== false) {
    await page.locator(".comp-panel").first().waitFor({ timeout: 9000 });
  }
}

async function fillManualIdentity(page: Page, identity: { name: string; setName: string; number: string; grade: string }) {
  const identityPanel = page.locator(".identity-details").first();
  await identityPanel.locator("label", { hasText: /^Card$/ }).locator("input").fill(identity.name);
  await identityPanel.locator("label", { hasText: /^Set$/ }).locator("input").fill(identity.setName);
  await identityPanel.locator("label", { hasText: /^Number$/ }).locator("input").fill(identity.number);
  await identityPanel.locator(".grade-select-field select").selectOption(identity.grade);
  await page.waitForTimeout(120);
}

function identityForText(text: string): { name: string; setName: string; number: string; grade: string } {
  const normalized = text.toLowerCase();
  if (normalized.includes("zapdos")) {
    return { name: "Zapdos ex", setName: "Scarlet & Violet 151", number: "192/165", grade: "BGS_9_5" };
  }
  if (normalized.includes("lugia")) {
    return { name: "Lugia", setName: "Neo Genesis", number: "9/111", grade: "CGC_1_5" };
  }
  if (normalized.includes("umbreon")) {
    return { name: "Umbreon ex", setName: "Prismatic Evolutions", number: "161/131", grade: "RAW" };
  }
  return { name: "Victini", setName: "Scarlet & Violet Black Star Promos", number: "208", grade: "RAW" };
}

async function scrollSheetToBottom(page: Page, selector: string) {
  await page.locator(selector).first().evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  }).catch(() => undefined);
}

async function setupPublishReadyMocks(page: Page) {
  await page.route("**/api/ebay/status", async (route) => {
    await route.fulfill({
      json: {
        configured: true,
        connected: true,
        tokenSource: "db",
        env: "production",
        marketplaceId: "EBAY_GB",
        hasPolicies: true,
        hasMerchantLocation: true,
        sellerRegistration: { completed: true },
        locationSetup: { configured: true, createAvailable: true, merchantLocationKey: "pdos-main", existsOnEbay: true },
        policies: {
          paymentPolicyId: "pay-visual",
          fulfillmentPolicyId: "ship-visual",
          returnPolicyId: "ret-visual",
          merchantLocationKey: "pdos-main",
          paymentPolicy: { id: "pay-visual", name: "Immediate payment" },
          fulfillmentPolicy: { id: "ship-visual", name: "Royal Mail buyer pays" },
          returnPolicy: { id: "ret-visual", name: "No returns" },
          merchantLocation: { merchantLocationKey: "pdos-main", name: "Poke Deal stock" },
        },
      },
    });
  });
  await page.route("**/api/listings", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const listings = Array.isArray(body.listings) ? body.listings : [];
    const targetIndex = listings.findIndex((listing: any) => listing.channel === "EBAY" && listing.state === "DRAFT" && listing.item);
    if (targetIndex >= 0) {
      const target = listings[targetIndex];
      const photoUrl = target.item?.card?.imageUrl ?? cardArt;
      listings[targetIndex] = {
        ...target,
        externalRef: "offer:visual-pass2",
        externalUrl: null,
        listPrice: target.listPrice ?? target.suggestedPrice ?? 2500,
        item: {
          ...target.item,
          photos: [{ id: "visual-real-photo", url: photoUrl, origin: "REAL", role: "FRONT", order: 0 }],
        },
      };
    }
    await route.fulfill({ json: { ...body, listings } });
  });
  await page.route("**/api/listings/*/ebay/publish", async (route) => {
    await route.fulfill({ json: { message: "Published on eBay.", externalRef: "1234567890", externalUrl: "https://www.ebay.co.uk/itm/1234567890" } });
  });
}

async function setupCompMock(page: Page, mode: "high" | "medium" | "low" | "ambiguous" | "asks" | "checked") {
  await page.route("**/api/comps**", async (route) => {
    await route.fulfill({ json: compPayload(mode) });
  });
}

async function setupSuggestionMocks(page: Page) {
  await page.route("**/api/catalog/cards**", async (route) => {
    await route.fulfill({ json: { cards: ambiguousCards() } });
  });
}

function compPayload(mode: "high" | "medium" | "low" | "ambiguous" | "asks" | "checked") {
  const confidence = mode === "low" ? "low" : mode === "medium" ? "medium" : "high";
  const source = mode === "checked" ? "checked-comps" : mode === "medium" ? "pokemon-price-tracker" : "poketrace";
  const sampleSize = mode === "low" ? 1 : mode === "medium" ? 8 : 245;
  const headline = {
    source,
    card: cardRef(),
    grade: "RAW",
    currency: "GBP",
    medianPence: mode === "low" ? 45000 : mode === "medium" ? 9250 : 1326,
    meanPence: mode === "low" ? 45000 : mode === "medium" ? 9250 : 1326,
    lowPence: mode === "low" ? 40000 : mode === "medium" ? 8800 : 1222,
    highPence: mode === "low" ? 50000 : mode === "medium" ? 9800 : 1443,
    sampleSize,
    windowDays: 90,
    trendPct: mode === "low" ? null : 4.9,
    outliersRemoved: 0,
    asOf: "2026-07-04T12:00:00.000Z",
    raw: {
      kind: mode === "checked" ? "checked-comp" : "market-baseline",
      source: "ebay-uk",
      sourceLabel: "eBay UK",
      entries: mode === "checked"
        ? [
            checkedEntry("checked-1", 1299),
            checkedEntry("checked-2", 1350),
          ]
        : undefined,
      reconciliation: {
        headlinePence: mode === "low" ? 45000 : mode === "medium" ? 9250 : 1326,
        confidence,
        manualCheck: mode === "low" || mode === "ambiguous",
        reasons: mode === "low" ? ["thin-source"] : [],
        chosenSource: source,
        trendPct: mode === "low" ? null : 4.9,
      },
    },
  };
  return {
    headline,
    all: [
      headline,
      {
        ...headline,
        source: "pokemon-tcg-market",
        medianPence: mode === "medium" ? 7400 : 1250,
        sampleSize: 1,
        raw: { kind: "catalog-market-baseline" },
      },
    ],
    sourcesDisagree: mode === "medium",
    reconciliation: headline.raw.reconciliation,
    unavailableSources: [],
    catalog: catalogCard(),
    alternatives: mode === "ambiguous" ? ambiguousCards() : [],
    ambiguous: mode === "ambiguous",
    askEvidence: mode === "asks" ? askEvidence() : null,
    psaCert: null,
  };
}

function cardRef() {
  return {
    name: "Victini",
    setName: "Scarlet & Violet Black Star Promos",
    number: "SVP208",
    game: "POKEMON",
    language: "EN",
    tcgApiId: "svp-208",
  };
}

function catalogCard() {
  return {
    ...cardRef(),
    rarity: "Promo",
    imageUrl: cardArt,
    setLogoUrl: "https://images.pokemontcg.io/svp/logo.png",
    setSymbolUrl: "https://images.pokemontcg.io/svp/symbol.png",
    priceSignals: { marketPence: 1300 },
  };
}

function ambiguousCards() {
  return [
    {
      name: "Umbreon ex",
      setName: "Prismatic Evolutions",
      number: "161/131",
      rarity: "Special Illustration Rare",
      imageUrl: "https://images.pokemontcg.io/sv8pt5/161_hires.png",
      tcgApiId: "sv8pt5-161",
      game: "POKEMON",
      language: "EN",
    },
    {
      name: "Umbreon",
      setName: "Prismatic Evolutions",
      number: "059/131",
      rarity: "Rare",
      imageUrl: "https://images.pokemontcg.io/sv8pt5/59_hires.png",
      tcgApiId: "sv8pt5-59",
      game: "POKEMON",
      language: "EN",
    },
  ];
}

function checkedEntry(id: string, pricePence: number) {
  return {
    id,
    cardId: "svp-208",
    grade: "RAW",
    pricePence,
    soldDate: "2026-07-04T00:00:00.000Z",
    platform: "ebay-uk",
    note: "visual audit",
    sourceUrl: "https://www.ebay.co.uk/sch/i.html?_nkw=Victini+SVP+208&LH_Sold=1",
    createdAt: "2026-07-04T12:00:00.000Z",
  };
}

function askEvidence() {
  return {
    source: "ebay-browse",
    marketplaceId: "EBAY_GB",
    query: "Victini SVP 208 raw",
    asOf: "2026-07-04T12:00:00.000Z",
    count: 3,
    lowestPence: 1499,
    undercutPence: 1399,
    cached: false,
    skipped: false,
    listings: [
      {
        itemId: "ask-1",
        title: "Victini SVP 208 Promo Pokemon Card NM",
        url: "https://www.ebay.co.uk/itm/visual-ask-1",
        itemPricePence: 1499,
        shippingPence: 0,
        totalPence: 1499,
        buyingOptions: ["FIXED_PRICE"],
        condition: "Ungraded",
        seller: "visual-seller",
      },
    ],
  };
}

async function assertNoHorizontalScroll(page: Page) {
  const metrics = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === "visible")
      .slice(0, 8)
      .map((el) => ({
        tag: el.tagName,
        className: el.className,
        text: el.textContent?.trim().replace(/\s+/g, " ").slice(0, 80),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      })),
  }));
  if (metrics.document > metrics.viewport || metrics.body > metrics.viewport) {
    console.warn("horizontal scroll detected", metrics);
  }
}
