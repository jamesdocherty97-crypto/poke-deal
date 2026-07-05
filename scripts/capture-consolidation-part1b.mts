import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit, type Browser, type BrowserType, type Page } from "playwright";

type Engine = { name: "chromium" | "webkit"; launcher: BrowserType };
type ViewportSpec = { name: string; width: number; height: number; mobile: boolean; scale: number };
type CaptureState = {
  name: string;
  viewports: ViewportSpec[];
  targetSelector: string;
  prepare: (page: Page) => Promise<void>;
};

const baseUrl = process.argv[2] ?? "http://localhost:3010";
const outDir = path.join(process.cwd(), "docs/consolidation/part1b");
const providerArt = "https://images.pokemontcg.io/sv8pt5/161_hires.png";
const scanPhotoPath = path.join(process.cwd(), "public/icon-192.png");

const engines: Engine[] = [
  { name: "chromium", launcher: chromium },
  { name: "webkit", launcher: webkit },
];
const phone: ViewportSpec = { name: "390x844", width: 390, height: 844, mobile: true, scale: 3 };
const desktop: ViewportSpec = { name: "1440x900", width: 1440, height: 900, mobile: false, scale: 1 };

await mkdir(outDir, { recursive: true });

const states: CaptureState[] = [
  {
    name: "provider-fallback-comp-header",
    viewports: [phone, desktop],
    targetSelector: ".comp-panel",
    prepare: async (page) => {
      await setupCompMock(page, "provider");
      await goto(page);
      await runComp(page, "Umbreon Prismatic RAW");
      await page.locator(".comp-identity-strip img, .comp-identity-strip .comp-identity-art").first().waitFor({ timeout: 7000 });
      await page.waitForTimeout(250);
    },
  },
  {
    name: "ambiguous-alternatives-art",
    viewports: [phone],
    targetSelector: ".catalog-alternatives",
    prepare: async (page) => {
      await setupCompMock(page, "ambiguous");
      await goto(page);
      await runComp(page, "Umbreon Prismatic RAW");
      await page.locator(".catalog-alternatives").first().waitFor({ timeout: 7000 });
      await page.waitForTimeout(250);
    },
  },
  {
    name: "checked-comp-logger-art",
    viewports: [phone, desktop],
    targetSelector: ".checked-comp-card",
    prepare: async (page) => {
      await setupCompMock(page, "provider");
      await goto(page);
      await runComp(page, "Umbreon Prismatic RAW");
      const logButton = page.getByRole("button", { name: /Log what you saw/i }).first();
      await logButton.scrollIntoViewIfNeeded();
      await logButton.dispatchEvent("click");
      await page.locator(".checked-comp-log-sheet").first().waitFor({ timeout: 7000 });
      await page.waitForTimeout(250);
    },
  },
  {
    name: "scan-confirmed-side-by-side",
    viewports: [phone],
    targetSelector: ".scan-art-compare",
    prepare: async (page) => {
      await setupScanMock(page, "confirmed");
      await setupCompMock(page, "provider");
      await goto(page);
      await page.getByRole("button", { name: /Scan card with camera/i }).click({ timeout: 7000, force: true });
      await page.locator('input[type="file"]').setInputFiles(scanPhotoPath);
      await page.locator(".scan-art-compare").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(300);
    },
  },
  {
    name: "scan-ambiguous-side-by-side",
    viewports: [phone],
    targetSelector: ".scan-sheet",
    prepare: async (page) => {
      await setupScanMock(page, "ambiguous");
      await goto(page);
      await page.getByRole("button", { name: /Scan card with camera/i }).click({ timeout: 7000, force: true });
      await page.locator('input[type="file"]').setInputFiles(scanPhotoPath);
      await page.locator(".scan-art-compare").first().waitFor({ timeout: 15000 });
      await page.locator(".scan-candidate-list").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(300);
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
    const file = `part1b-${engine}-${viewport.name}-${state.name}.jpg`;
    const target = page.locator(state.targetSelector).first();
    await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
    await target.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 82 });
    console.log(`captured ${file}`);
  } catch (err) {
    console.error(`capture failed ${engine} ${viewport.name} ${state.name}:`, err instanceof Error ? err.message : err);
    const file = `part1b-${engine}-${viewport.name}-${state.name}-failed.jpg`;
    await page.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 82, fullPage: false }).catch(() => undefined);
  } finally {
    await context.close();
  }
}

async function goto(page: Page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
}

async function runComp(page: Page, text: string) {
  await page.getByLabel("Smart comp search").fill(text);
  await fillManualIdentity(page, identityForText(text));
  await page.locator("form.lookup-panel").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  await page.locator(".comp-panel").first().waitFor({ timeout: 9000 });
}

async function fillManualIdentity(page: Page, identity: { name: string; setName: string; number: string; grade: string }) {
  const identityPanel = page.locator(".identity-details").first();
  await identityPanel.locator("label", { hasText: /^Card$/ }).locator("input").fill(identity.name);
  await identityPanel.locator("label", { hasText: /^Set$/ }).locator("input").fill(identity.setName);
  await identityPanel.locator("label", { hasText: /^Number$/ }).locator("input").fill(identity.number);
  await identityPanel.locator(".grade-select-field select").selectOption(identity.grade);
  await page.waitForTimeout(120);
}

function identityForText(text: string) {
  if (/umbreon/i.test(text)) {
    return { name: "Umbreon ex", setName: "Prismatic Evolutions", number: "161/131", grade: "RAW" };
  }
  return { name: "Victini", setName: "Scarlet & Violet Black Star Promos", number: "SVP 208", grade: "RAW" };
}

async function setupCompMock(page: Page, mode: "provider" | "ambiguous") {
  await page.route("**/api/comps**", async (route) => {
    await route.fulfill({ json: mode === "ambiguous" ? ambiguousCompPayload() : providerFallbackCompPayload() });
  });
}

async function setupScanMock(page: Page, mode: "confirmed" | "ambiguous") {
  await page.route("**/api/scan", async (route) => {
    await route.fulfill({
      json: {
        model: "visual-proof-scan",
        identity: mode === "ambiguous"
          ? {
              name: "Umbreon",
              setName: null,
              setCode: null,
              number: "161/131",
              language: "English",
              isSlab: false,
              grader: null,
              grade: null,
              certNumber: null,
              stamps: [],
              readable: true,
              notes: "visual proof",
            }
          : {
              name: "Umbreon ex",
              setName: "Prismatic Evolutions",
              setCode: null,
              number: "161/131",
              language: "English",
              isSlab: false,
              grader: null,
              grade: null,
              certNumber: null,
              stamps: [],
              readable: true,
              notes: "visual proof",
            },
      },
    });
  });
  await page.route("**/api/catalog/cards**", async (route) => {
    await route.fulfill({ json: { cards: mode === "ambiguous" ? ambiguousCards() : [catalogProviderCard({ imageUrl: null, displayImageUrl: providerArt })] } });
  });
}

function providerFallbackCompPayload() {
  const headline = {
    source: "poketrace",
    card: {
      name: "Umbreon ex",
      setName: "Prismatic Evolutions",
      number: "161/131",
      game: "POKEMON",
      language: "EN",
    },
    grade: "RAW",
    currency: "GBP",
    medianPence: 1326,
    meanPence: 1326,
    lowPence: 1222,
    highPence: 1443,
    sampleSize: 24,
    windowDays: 90,
    trendPct: 4.9,
    outliersRemoved: 0,
    asOf: "2026-07-05T12:00:00.000Z",
    raw: {
      kind: "poketrace",
      displayImageUrl: providerArt,
      providerCard: { imageUrl: providerArt },
      reconciliation: {
        headlinePence: 1326,
        confidence: "medium",
        manualCheck: false,
        reasons: ["provider-display-image"],
        chosenSource: "poketrace",
        trendPct: 4.9,
      },
    },
  };
  return {
    headline,
    all: [headline],
    sourcesDisagree: false,
    reconciliation: headline.raw.reconciliation,
    unavailableSources: [],
    catalog: catalogProviderCard({ imageUrl: null, displayImageUrl: null }),
    cardImage: { imageUrl: providerArt, source: "poketrace", listingSafe: false },
    alternatives: [],
    ambiguous: false,
    askEvidence: null,
    psaCert: null,
  };
}

function ambiguousCompPayload() {
  const payload = providerFallbackCompPayload();
  return {
    ...payload,
    catalog: null,
    alternatives: ambiguousCards(),
    ambiguous: true,
  };
}

function catalogProviderCard(options: { imageUrl: string | null; displayImageUrl: string | null }) {
  return {
    name: "Umbreon ex",
    setName: "Prismatic Evolutions",
    number: "161/131",
    rarity: "Special Illustration Rare",
    imageUrl: options.imageUrl,
    displayImageUrl: options.displayImageUrl,
    sourceLabel: "Pokemon TCG API",
    game: "POKEMON",
    language: "EN",
    tcgApiId: "sv8pt5-161",
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
      sourceLabel: "Pokemon TCG API",
      game: "POKEMON",
      language: "EN",
      tcgApiId: "sv8pt5-161",
    },
    {
      name: "Umbreon",
      setName: "Prismatic Evolutions",
      number: "059/131",
      rarity: "Rare",
      imageUrl: "https://images.pokemontcg.io/sv8pt5/59_hires.png",
      sourceLabel: "Pokemon TCG API",
      game: "POKEMON",
      language: "EN",
      tcgApiId: "sv8pt5-59",
    },
  ];
}
