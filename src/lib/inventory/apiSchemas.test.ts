import assert from "node:assert/strict";
import test from "node:test";
import { acquireRequestSchema, inventoryDraftRequestSchema } from "./apiSchemas.js";

test("acquire requests omit blank optional card identity fields", () => {
  const parsed = acquireRequestSchema.parse({
    card: {
      name: " Pikachu ",
      setName: "  ",
      number: "",
      tcgApiId: "\t",
      tcgDexId: "",
      cardmarketId: " ",
    },
    costBasisPence: 500,
  });

  assert.equal(parsed.card.name, "Pikachu");
  assert.equal(parsed.card.setName, undefined);
  assert.equal(parsed.card.number, undefined);
  assert.equal(parsed.card.tcgApiId, undefined);
  assert.equal(parsed.card.tcgDexId, undefined);
  assert.equal(parsed.card.cardmarketId, undefined);
  assert.equal(parsed.card.language, "EN");
});

test("inventory create requests trim non-blank identity fields and tolerate a blank id", () => {
  const parsed = inventoryDraftRequestSchema.parse({
    card: {
      id: " ",
      name: " Eevee ",
      setName: " Twilight Masquerade ",
      number: " 188/167 ",
      tcgApiId: " sv6-188 ",
    },
    costBasisPence: 1200,
  });

  assert.equal(parsed.card.id, undefined);
  assert.equal(parsed.card.name, "Eevee");
  assert.equal(parsed.card.setName, "Twilight Masquerade");
  assert.equal(parsed.card.number, "188/167");
  assert.equal(parsed.card.tcgApiId, "sv6-188");
});

test("request schemas still reject a blank required card name", () => {
  const input = { card: { name: " ", setName: "", number: "" }, costBasisPence: 0 };

  assert.equal(acquireRequestSchema.safeParse(input).success, false);
  assert.equal(inventoryDraftRequestSchema.safeParse(input).success, false);
});

test("acquire accepts a reviewed comp receipt without another lookup", () => {
  const result = acquireRequestSchema.parse({
    card: { name: "Umbreon", setName: "Neo Discovery", number: "13" },
    costBasisPence: 8_000,
    reviewedComps: {
      headline: {
        source: "ebay-marketplace-insights",
        medianPence: 14_500,
        meanPence: 14_900,
        lowPence: 12_000,
        highPence: 17_500,
        sampleSize: 8,
        windowDays: 30,
        trendPct: null,
        outliersRemoved: 1,
        asOf: "2026-07-16T10:30:00.000Z",
      },
      all: [
        {
          source: "ebay-marketplace-insights",
          medianPence: 14_500,
          meanPence: 14_900,
          lowPence: 12_000,
          highPence: 17_500,
          sampleSize: 8,
          windowDays: 30,
          trendPct: null,
          outliersRemoved: 1,
          asOf: "2026-07-16T10:30:00.000Z",
        },
      ],
      sourcesDisagree: false,
    },
  });

  assert.equal(result.reviewedComps?.headline.medianPence, 14_500);
  assert.equal(result.reviewedComps?.all.length, 1);
});
