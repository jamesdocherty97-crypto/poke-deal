import assert from "node:assert/strict";
import test from "node:test";

import type { CardRef, CompResult } from "../domain/types.js";
import { pickHeadlineForQuery } from "./compService.js";
import { mapCheckedCompsToComp, type CheckedCompRow } from "./sources/checkedComps.js";

const cardRef: CardRef = {
  id: "rayquaza-vmax-218",
  game: "POKEMON",
  language: "EN",
  name: "Rayquaza VMAX",
  setName: "Evolving Skies",
  number: "218/203",
  tcgApiId: "swsh7-218",
};

const card: CheckedCompRow["card"] = {
  id: "rayquaza-vmax-218",
  game: "POKEMON" as const,
  language: "EN" as const,
  name: "Rayquaza VMAX",
  setName: "Evolving Skies",
  setCode: "swsh7",
  number: "218/203",
  rarity: "Secret Rare",
  imageUrl: null,
  displayImageUrl: null,
  tcgApiId: "swsh7-218",
  tcgDexId: null,
  cardmarketId: null,
};

function checkedRow(id: string, itemId: string, pricePence: number, soldDate: string): CheckedCompRow {
  return {
    id,
    cardId: card.id,
    grade: "RAW",
    pricePence,
    soldDate: new Date(soldDate),
    platform: "ebay-uk",
    condition: "NM",
    priceBasis: "DISPLAYED_PRICE",
    note: null,
    sourceUrl: `https://www.ebay.co.uk/itm/${itemId}`,
    sourceListingId: `ebay-uk:${itemId}`,
    createdAt: new Date(soldDate),
    card,
  };
}

function providerComp(overrides: Partial<CompResult> & Pick<CompResult, "source" | "medianPence">): CompResult {
  const { source, medianPence: value, ...rest } = overrides;
  return {
    source,
    card: cardRef,
    grade: "RAW",
    currency: "GBP",
    medianPence: value,
    meanPence: value,
    lowPence: value,
    highPence: value,
    sampleSize: 1,
    windowDays: 30,
    trendPct: null,
    outliersRemoved: 0,
    asOf: "2026-07-18T12:00:00.000Z",
    ...rest,
  };
}

test("Rayquaza benchmark: the dealer-observed £450–£750 eBay UK range beats the £1k+ approximate baseline", () => {
  const ebayUk = mapCheckedCompsToComp([
    checkedRow("uk-450", "100000000101", 45_000, "2026-06-10T12:00:00.000Z"),
    checkedRow("uk-600", "100000000102", 60_000, "2026-06-20T12:00:00.000Z"),
    checkedRow("uk-750", "100000000103", 75_000, "2026-06-30T12:00:00.000Z"),
  ], {
    source: "checked-comps",
    card: cardRef,
    grade: "RAW",
    condition: "NM",
    windowDays: 90,
    now: new Date("2026-07-19T12:00:00.000Z"),
  });

  const priceTrackerContaminated = providerComp({
    source: "pokemon-price-tracker",
    medianPence: 205_137,
    meanPence: 66_000,
    lowPence: 38_000,
    highPence: 250_000,
    sampleSize: 98,
    raw: {
      chosenPriceSource: "smartMarketPrice",
      aggregateMedianPence: 66_000,
      market: "US",
    },
  });
  const pokeTraceApproximate = providerComp({
    source: "poketrace",
    medianPence: 103_981,
    sampleSize: 64,
    raw: {
      kind: "sold-aggregate",
      priceSource: "ebay",
      market: "US",
      tier: "NEAR_MINT",
      approxSaleCount: true,
      providerCard: { name: cardRef.name, setName: cardRef.setName, number: cardRef.number, language: "EN" },
      signals: [
        { priceSource: "ebay", medianPence: 103_981, sampleSize: 64 },
        { priceSource: "tcgplayer", medianPence: 91_006, sampleSize: 230 },
      ],
    },
  });
  const tcgMarket = providerComp({
    source: "pokemon-tcg-market",
    medianPence: 91_006,
    sampleSize: 230,
    raw: { kind: "catalog-market-baseline", market: "US" },
  });

  const result = pickHeadlineForQuery(
    [priceTrackerContaminated, pokeTraceApproximate, tcgMarket, ebayUk],
    cardRef,
    { grade: "RAW", condition: "NM" },
  );

  assert.equal(ebayUk.medianPence, 60_000);
  assert.equal(ebayUk.sampleSize, 3);
  assert.equal(result.headline?.source, "checked-comps");
  assert.equal(result.reconciliation.headlinePence, 60_000);
  assert.equal(result.reconciliation.chosenSource, "checked-comps");
  assert.equal(result.reconciliation.manualCheck, true);
  assert.equal(result.reconciliation.selection?.lowPence, 45_000);
  assert.equal(result.reconciliation.selection?.highPence, 75_000);
  assert.equal(result.reconciliation.selection?.crossSourceLowPence, 60_000);
  assert.equal(result.reconciliation.selection?.crossSourceHighPence, 103_981);
  assert.match(result.reconciliation.reasons.join(" "), /smart-diverges-from-own-median/);
  assert.match(result.reconciliation.reasons.join(" "), /approximate-sample-capped:64-to-50:poketrace/);
});

test("Rayquaza benchmark: high-value foreign-only evidence never becomes an automatic offer", () => {
  const result = pickHeadlineForQuery([
    providerComp({
      source: "poketrace",
      medianPence: 103_981,
      sampleSize: 64,
      raw: { kind: "sold-aggregate", market: "US", priceSource: "ebay", approxSaleCount: true },
    }),
  ], cardRef, { grade: "RAW", condition: "NM" });

  assert.equal(result.reconciliation.headlinePence, 103_981);
  assert.equal(result.reconciliation.confidence, "medium");
  assert.equal(result.reconciliation.manualCheck, true);
  assert.equal(result.reconciliation.selection?.sampleSize, 50);
  assert.equal(result.reconciliation.selection?.reportedSampleSize, 64);
  assert.match(result.reconciliation.reasons.join(" "), /high-value-without-uk-solds/);
});

test("Rayquaza benchmark: a four-times-wide checked range is corroboration-only", () => {
  const contaminated = mapCheckedCompsToComp([
    checkedRow("uk-1", "100000000001", 45_000, "2026-06-10T12:00:00.000Z"),
    checkedRow("uk-2", "100000000002", 60_000, "2026-06-20T12:00:00.000Z"),
    checkedRow("uk-3", "100000000003", 190_000, "2026-06-30T12:00:00.000Z"),
  ], {
    source: "checked-comps",
    card: cardRef,
    grade: "RAW",
    condition: "NM",
    windowDays: 90,
    now: new Date("2026-07-19T12:00:00.000Z"),
  });
  const result = pickHeadlineForQuery([
    contaminated,
    providerComp({ source: "poketrace", medianPence: 100_000, sampleSize: 64, raw: { approxSaleCount: true, market: "US" } }),
  ], cardRef, { grade: "RAW", condition: "NM" });

  assert.equal(contaminated.highPence / contaminated.lowPence > 4, true);
  assert.equal(result.reconciliation.chosenSource, "poketrace");
  assert.equal(result.reconciliation.manualCheck, true);
  assert.match(result.reconciliation.reasons.join(" "), /corroboration-wide-checked-comps/);
});
