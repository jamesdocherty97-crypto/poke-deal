import assert from "node:assert/strict";
import test from "node:test";
import type { CompResult } from "../domain/types.js";
import { providerImageFromCompResult, resolveCompCardImage } from "./cardArt.js";

function comp(source: string, raw?: unknown): CompResult {
  return {
    source,
    card: { name: "Tauros", setName: "Chaos Rising", number: "69/86", game: "POKEMON", language: "EN" },
    grade: "RAW",
    currency: "GBP",
    medianPence: 100,
    meanPence: 100,
    lowPence: 90,
    highPence: 110,
    sampleSize: 5,
    windowDays: 90,
    trendPct: null,
    outliersRemoved: 0,
    asOf: "2026-07-05T10:00:00.000Z",
    raw,
  };
}

test("catalog art wins and remains listing-safe", () => {
  const image = resolveCompCardImage({
    catalog: {
      imageUrl: "https://images.pokemontcg.io/me4/69_hires.png",
      displayImageUrl: "https://cdn.poketrace.com/cards/tauros.webp",
    },
    all: [comp("poketrace", { providerCard: { imageUrl: "https://cdn.poketrace.com/cards/tauros.webp" } })],
  });

  assert.deepEqual(image, {
    imageUrl: "https://images.pokemontcg.io/me4/69_hires.png",
    source: "catalog",
    listingSafe: true,
  });
});

test("no catalog image falls back to PokeTrace provider art for display only", () => {
  const image = resolveCompCardImage({
    all: [comp("poketrace", { providerCard: { imageUrl: "https://cdn.poketrace.com/cards/tauros.webp" } })],
  });

  assert.deepEqual(image, {
    imageUrl: "https://cdn.poketrace.com/cards/tauros.webp",
    source: "poketrace",
    listingSafe: false,
  });
});

test("no catalog or PokeTrace image falls back to Price Tracker provider art for display only", () => {
  const image = resolveCompCardImage({
    all: [comp("pokemon-price-tracker", { providerCard: { imageCdnUrl800: "https://tcgplayer-cdn.tcgplayer.com/product/693552_in_800x800.jpg" } })],
  });

  assert.equal(image.imageUrl, "https://tcgplayer-cdn.tcgplayer.com/product/693552_in_800x800.jpg");
  assert.equal(image.source, "pokemon-price-tracker");
  assert.equal(image.listingSafe, false);
});

test("no image anywhere returns a placeholder instruction rather than a broken URL", () => {
  const image = resolveCompCardImage({ all: [comp("poketrace", { providerCard: { name: "Tauros" } })] });

  assert.deepEqual(image, { imageUrl: null, source: "none", listingSafe: false });
});

test("providerImageFromCompResult ignores non-http and malformed values", () => {
  assert.equal(providerImageFromCompResult(comp("poketrace", { providerCard: { imageUrl: "javascript:alert(1)" } })), null);
});
