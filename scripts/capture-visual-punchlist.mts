import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit, type Browser, type BrowserType, type Page } from "playwright";

type Engine = { name: "chromium" | "webkit"; launcher: BrowserType };
type ViewportSpec = { name: string; width: number; height: number; mobile: boolean; scale: number };
type CaptureState = {
  name: string;
  prepare: (page: Page) => Promise<void>;
};

const phase = process.argv[2] ?? "after";
const baseUrl = process.argv[3] ?? "http://localhost:3000";
const outDir = path.join(process.cwd(), "docs/visual-audit/punch-list-2026-07-04", phase);
const engines: Engine[] = [
  { name: "chromium", launcher: chromium },
  { name: "webkit", launcher: webkit },
];
const viewports: ViewportSpec[] = [
  { name: "390x844", width: 390, height: 844, mobile: true, scale: 3 },
  { name: "1440x900", width: 1440, height: 900, mobile: false, scale: 1 },
];

await mkdir(outDir, { recursive: true });

const states: CaptureState[] = [
  {
    name: "inventory-more-actions-sheet",
    prepare: async (page) => {
      await goto(page);
      await clickTab(page, "Inventory");
      await clickButton(page, /More actions/i);
      await page.waitForTimeout(300);
    },
  },
  {
    name: "inventory-sell-sheet-single-primary",
    prepare: async (page) => {
      await goto(page);
      await clickTab(page, "Inventory");
      await clickButton(page, /More actions/i);
      await clickSheetButton(page, /Record sale/i);
      await page.waitForTimeout(300);
    },
  },
  {
    name: "buy-empty-chips-placeholder",
    prepare: async (page) => {
      await goto(page);
      await clickTab(page, "Buy");
      await page.waitForTimeout(300);
    },
  },
  {
    name: "buy-resolved-decision-spacing",
    prepare: async (page) => {
      await setupCompMock(page);
      await goto(page);
      await clickTab(page, "Buy");
      await page.getByLabel(/^Card$/i).fill("Victini");
      await page.getByLabel(/^Set$/i).fill("Scarlet & Violet Black Star Promos");
      await page.getByLabel(/^Number$/i).fill("SVP 208");
      await page.getByRole("button", { name: /Comp from typed fields/i }).click({ timeout: 7000 });
      await page.locator(".quick-stock-card .money-input input").first().fill("5");
      await page.waitForTimeout(350);
    },
  },
  {
    name: "listing-pack-honest-steps",
    prepare: async (page) => {
      await goto(page);
      await clickTab(page, "Listings");
      await clickButton(page, /Open pack|Pack/i);
      await page.waitForTimeout(350);
    },
  },
  {
    name: "setup-deep-health-rows",
    prepare: async (page) => {
      await setupHealthMock(page);
      await goto(page);
      await page.getByRole("button", { name: /Status/i }).click({ timeout: 6000, force: true });
      await page.waitForTimeout(250);
      await clickButton(page, /Deep check/i);
      await page.waitForTimeout(350);
    },
  },
];

for (const engine of engines) {
  const browser = await engine.launcher.launch();
  try {
    for (const state of states) {
      for (const viewport of viewports) {
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

async function clickTab(page: Page, label: string) {
  const nav = page.getByRole("navigation", { name: /Primary/i });
  const button = nav.getByRole("button", { name: new RegExp(label, "i") }).first();
  await button.click({ timeout: 6000, force: true });
  await page.waitForTimeout(250);
}

async function clickButton(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name }).first();
  await button.click({ timeout: 7000 });
  await page.waitForTimeout(250);
}

async function clickSheetButton(page: Page, name: RegExp) {
  const sheet = page.locator(".row-action-sheet").first();
  const button = sheet.getByRole("button", { name }).first();
  await button.scrollIntoViewIfNeeded({ timeout: 3000 });
  await button.click({ timeout: 7000, force: true });
  await page.waitForTimeout(250);
}

async function setupCompMock(page: Page) {
  await page.route("**/api/comps**", async (route) => {
    await route.fulfill({ json: compPayload() });
  });
  await page.route("**/api/catalog/search**", async (route) => {
    await route.fulfill({
      json: {
        cards: [
          {
            name: "Victini",
            setName: "Scarlet & Violet Black Star Promos",
            number: "SVP 208",
            rarity: "Promo",
            imageUrl: "https://images.pokemontcg.io/svp/208_hires.png",
            sourceLabel: "Pokemon TCG API",
          },
        ],
      },
    });
  });
}

async function setupHealthMock(page: Page) {
  await page.route("**/api/system/health", async (route) => {
    await route.fulfill({
      json: {
        checkedAt: new Date().toISOString(),
        sources: [
          { id: "pokemon-price-tracker", status: "ok", latencyMs: 420, detail: "PSA 10 sample 34, median £102.40.", checkedAt: new Date().toISOString() },
          { id: "poketrace", status: "ok", latencyMs: 680, detail: "RAW signal 18, median £12.80.", checkedAt: new Date().toISOString() },
          { id: "ebay-sell-api", status: "skipped", latencyMs: 120, detail: "No seller OAuth refresh token stored.", checkedAt: new Date().toISOString() },
        ],
      },
    });
  });
}

async function assertNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
  if (overflow > 2) throw new Error(`horizontal overflow ${overflow}px`);
}

function compPayload() {
  return {
    catalog: {
      name: "Victini",
      setName: "Scarlet & Violet Black Star Promos",
      number: "SVP 208",
      imageUrl: "https://images.pokemontcg.io/svp/208_hires.png",
    },
    headline: {
      source: "poketrace",
      card: { name: "Victini", setName: "Scarlet & Violet Black Star Promos", number: "SVP 208" },
      grade: "RAW",
      currency: "GBP",
      medianPence: 1280,
      meanPence: 1280,
      lowPence: 1100,
      highPence: 1450,
      sampleSize: 18,
      windowDays: 30,
      trendPct: null,
      outliersRemoved: 0,
      asOf: new Date().toISOString(),
    },
    all: [
      {
        source: "poketrace",
        card: { name: "Victini", setName: "Scarlet & Violet Black Star Promos", number: "SVP 208" },
        grade: "RAW",
        currency: "GBP",
        medianPence: 1280,
        meanPence: 1280,
        lowPence: 1100,
        highPence: 1450,
        sampleSize: 18,
        windowDays: 30,
        trendPct: null,
        outliersRemoved: 0,
        asOf: new Date().toISOString(),
        raw: { kind: "market-baseline", market: "US" },
      },
    ],
    sourcesDisagree: false,
    reconciliation: {
      confidence: "high",
      manualCheck: false,
      reasons: ["reconciled-cleanly"],
      headlinePence: 1280,
      chosenSource: "poketrace",
    },
    askEvidence: {
      source: "ebay-browse",
      marketplaceId: "EBAY_GB",
      query: "Victini SVP 208",
      asOf: new Date().toISOString(),
      count: 1,
      listings: [],
      lowestPence: null,
      undercutPence: null,
    },
  };
}
