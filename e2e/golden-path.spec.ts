import { expect, test } from "playwright/test";

const card = { name: "Gengar", setName: "Lost Origin", number: "TG06/TG30", game: "POKEMON", language: "EN" };
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
  asOf: "2026-07-11T09:00:00.000Z",
};
const reconciliation = {
  headlinePence: 4200,
  confidence: "medium",
  manualCheck: false,
  reasons: [],
  chosenSource: "checked-comps",
  trendPct: null,
};
const reconciled = { headline, all: [headline], sourcesDisagree: false, reconciliation };

test("fixture golden path: scan -> progressive confidence receipt -> durable acquire request", async ({ page }) => {
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      identity: { name: "Gengar", setName: "Lost Origin", setCode: "LOR", number: "TG06/TG30", language: "English", isSlab: false, grader: null, grade: null, certNumber: null, stamps: [], readable: true, notes: "" },
      model: "fixture-vision-v1",
      scanEventId: "scan_fixture_1",
    }),
  }));
  await page.route("**/api/comps/stream**", (route) => {
    const base = { version: 1, lookupId: "lookup_fixture_1", emittedAt: "2026-07-11T09:00:00.000Z" };
    const receipt = {
      ...reconciled,
      catalog: { ...card, setCode: "swsh11", imageUrl: "https://example.test/gengar.png" },
      alternatives: [],
      ambiguous: false,
      psaCert: null,
      cardImage: { imageUrl: "https://example.test/gengar.png", source: "catalog", listingSafe: true },
      askEvidence: { source: "ebay-browse", marketplaceId: "EBAY_GB", query: "Gengar", asOf: base.emittedAt, count: 0, listings: [], lowestPence: null, undercutPence: null, skipped: true },
    };
    const events = [
      { ...base, sequence: 1, type: "catalog", requested: card, identity: card, grade: "RAW", catalog: receipt.catalog, ambiguity: false, sources: [{ name: "checked-comps", live: true }] },
      { ...base, sequence: 2, type: "source", source: { name: "checked-comps", live: true }, status: "priced", latencyMs: 12, completed: 1, total: 1, result: headline, receipt: reconciled },
      { ...base, sequence: 3, type: "verdict", phase: "provisional", ambiguity: false, pricedSourceCount: 1, receipt: reconciled },
      { ...base, sequence: 4, type: "receipt", latencyMs: 14, receipt },
    ];
    return route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
  });
  await page.route("**/api/inventory/acquire", async (route) => {
    expect(route.request().headers()["x-poke-deal-mutation-id"]).toBe("buy:fixture-0001");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ item: { id: "item_fixture_1", card, grade: "RAW", quantity: 1, costBasisPence: 2500, status: "IN_STOCK" }, suggestion: { pricePence: 4200 } }),
    });
  });

  await page.goto("/privacy");
  const outcome = await page.evaluate(async () => {
    const scan = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json", "X-Poke-Deal-Session-Id": "e2e-session" }, body: JSON.stringify({ imageBase64: "Zml4dHVyZQ==", mimeType: "image/jpeg" }) }).then((res) => res.json());
    const streamText = await fetch(`/api/comps/stream?name=${encodeURIComponent(scan.identity.name)}&setName=${encodeURIComponent(scan.identity.setName)}&number=${encodeURIComponent(scan.identity.number)}&grade=RAW`).then((res) => res.text());
    const events = streamText.trim().split("\n").map((line) => JSON.parse(line));
    const buy = await fetch("/api/inventory/acquire", { method: "POST", headers: { "Content-Type": "application/json", "X-Poke-Deal-Mutation-Id": "buy:fixture-0001" }, body: JSON.stringify({ card: events.at(-1).receipt.headline.card, grade: "RAW", costBasisPence: 2500 }) }).then((res) => res.json());
    return { scan, events, buy };
  });

  expect(outcome.scan.identity.number).toBe("TG06/TG30");
  expect(outcome.events.map((event: { type: string }) => event.type)).toEqual(["catalog", "source", "verdict", "receipt"]);
  expect(outcome.events[2].receipt.headline).toMatchObject({ medianPence: 4200, sampleSize: 7, windowDays: 90 });
  expect(outcome.events[2].receipt.reconciliation.confidence).toBe("medium");
  expect(outcome.buy.item.costBasisPence).toBe(2500);
});
