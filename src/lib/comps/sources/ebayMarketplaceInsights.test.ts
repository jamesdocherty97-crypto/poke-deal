import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildEbayMarketplaceInsightsQuery,
  mapEbayMarketplaceInsightsToComp,
} from "./ebayMarketplaceInsights.js";
import type { CardRef } from "../../domain/types.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/ebay-marketplace-insights-item-sales.json", import.meta.url)), "utf8"),
);

const victini: CardRef = {
  name: "Victini",
  setName: "Scarlet & Violet Black Star Promos",
  number: "SVP208",
};

test("buildEbayMarketplaceInsightsQuery uses human grade wording for slabs", () => {
  assert.equal(
    buildEbayMarketplaceInsightsQuery(victini, "ACE_10"),
    "Victini SVP 208 Scarlet & Violet Black Star Promos ACE 10",
  );
  assert.equal(
    buildEbayMarketplaceInsightsQuery({ name: "Zapdos ex", setName: "151", number: "192/165" }, "BGS_9_5"),
    "Zapdos ex 192/165 151 BGS 9.5",
  );
});

test("buildEbayMarketplaceInsightsQuery keeps RAW searches aligned to manual eBay fallback", () => {
  assert.equal(
    buildEbayMarketplaceInsightsQuery({ name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06/TG30" }, "RAW"),
    "Gengar TG06/TG30 Lost Origin Trainer Gallery -PSA -BGS -CGC -ACE -SGC -graded",
  );
});

test("mapEbayMarketplaceInsightsToComp cleans UK item sales into GBP comps", () => {
  const comp = mapEbayMarketplaceInsightsToComp(fixture, {
    source: "ebay-marketplace-insights",
    card: victini,
    grade: "ACE_10",
    windowDays: 30,
  });

  assert.equal(comp.source, "ebay-marketplace-insights");
  assert.equal(comp.currency, "GBP");
  assert.equal(comp.grade, "ACE_10");
  assert.equal(comp.sampleSize, 3);
  assert.equal(comp.medianPence, 4500);
  assert.equal(comp.lowPence, 4200);
  assert.equal(comp.highPence, 4800);
  assert.equal(comp.asOf, "2026-06-22T10:00:00.000Z");
});

test("mapEbayMarketplaceInsightsToComp drops wrong grade sales", () => {
  const comp = mapEbayMarketplaceInsightsToComp(
    {
      itemSales: [
        {
          title: "Victini SVP 208 PSA 10",
          price: { value: "75.00", currency: "GBP" },
          itemSoldDate: "2026-06-22T10:00:00.000Z",
        },
      ],
    },
    {
      source: "ebay-marketplace-insights",
      card: victini,
      grade: "ACE_10",
      windowDays: 30,
    },
  );

  assert.equal(comp.sampleSize, 0);
  assert.match(JSON.stringify(comp.raw), /none survived cleaning/);
});
