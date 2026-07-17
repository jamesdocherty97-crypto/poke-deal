import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogCard } from "./types.js";
import { catalogIdentityKey, mergeCatalogCards } from "./catalogIdentity.js";

const base: CatalogCard = {
  game: "POKEMON",
  language: "EN",
  name: "Charizard ex",
  setName: "151",
  setCode: "sv3pt5",
  number: "199/165",
};

test("canonical catalog merge collapses cross-provider records and retains complementary evidence", () => {
  const merged = mergeCatalogCards([
    {
      ...base,
      tcgApiId: "sv3pt5-199",
      imageUrl: "https://images.test/card-400.webp",
      priceSignals: [{ source: "tcgplayer", label: "Market", pricePence: 1000, originalAmount: 12, originalCurrency: "USD", kind: "market" }],
      provenance: { origin: "live", providers: ["pokemon-tcg-api"], retrievedAt: "2026-07-16T10:00:00.000Z" },
    },
    {
      ...base,
      tcgDexId: "sv03.5-199",
      cardmarketId: "12345",
      imageUrl: "https://images.test/card-800.webp",
      priceSignals: [{ source: "cardmarket", label: "Trend", pricePence: 1100, originalAmount: 13, originalCurrency: "EUR", kind: "trendPrice" }],
      provenance: { origin: "cache", providers: ["tcgdex", "cardmarket"], cachedAt: "2026-07-16T09:00:00.000Z" },
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.tcgApiId, "sv3pt5-199");
  assert.equal(merged[0]!.tcgDexId, "sv03.5-199");
  assert.equal(merged[0]!.cardmarketId, "12345");
  assert.equal(merged[0]!.imageUrl, "https://images.test/card-800.webp");
  assert.equal(merged[0]!.priceSignals?.length, 2);
  assert.deepEqual(merged[0]!.provenance?.providers, ["pokemon-tcg-api", "tcgdex", "cardmarket"]);
  assert.equal(merged[0]!.provenance?.origin, "live");
});

test("canonical identity keeps edition, finish and language variants separate", () => {
  const unlimited = { ...base, name: "Charizard", setName: "Base", number: "4/102", edition: "UNLIMITED" as const, finish: "HOLO" as const };
  const firstEdition = { ...unlimited, edition: "FIRST_EDITION" as const };
  const reverse = { ...unlimited, finish: "REVERSE_HOLO" as const };
  const japanese = { ...unlimited, language: "JP" as const };

  assert.equal(new Set([unlimited, firstEdition, reverse, japanese].map(catalogIdentityKey)).size, 4);
  assert.equal(mergeCatalogCards([unlimited, firstEdition, reverse, japanese]).length, 4);
});
