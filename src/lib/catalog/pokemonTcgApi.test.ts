import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPokemonTcgSearchQueries,
  buildPokemonTcgSearchQuery,
  mapPokemonTcgCard,
  normalizeCollectorNumber,
  pickCatalogPriceSignal,
  PokemonTcgApiCatalogSource,
} from "./pokemonTcgApi.js";

test("buildPokemonTcgSearchQuery (most specific level) resolves set names to set.id", () => {
  // "151" is the real Pokemon TCG API set name for sv3pt5; resolving it to
  // set.id:sv3pt5 instead of an exact-phrase set.name match is what makes
  // this robust to nicknames the literal API name wouldn't tokenize as.
  assert.equal(
    buildPokemonTcgSearchQuery({
      name: "Charizard ex",
      setName: "151",
      number: "199/165",
    }),
    'name:"Charizard ex" number:"199" set.id:sv3pt5',
  );
});

test("buildPokemonTcgSearchQueries produces progressively looser fallback levels", () => {
  // This reproduces the exact bug James reported: searching "Charizard",
  // collector number "04/102", set "base set" used to return nothing
  // because (a) the API stores the number without the leading zero and
  // (b) set.name:"base set" never matches the API's literal name "Base".
  const queries = buildPokemonTcgSearchQueries({
    name: "Charizard",
    setName: "base set",
    number: "04/102",
  });

  assert.deepEqual(queries, [
    'name:"Charizard" number:"4" set.id:base1',
    'name:"Charizard" set.id:base1',
    'name:"Charizard" number:"4"',
    'name:"Charizard"',
  ]);
});

test("buildPokemonTcgSearchQueries drops the set term entirely when it can't be resolved", () => {
  const queries = buildPokemonTcgSearchQueries({
    name: "Charizard",
    setName: "some set that does not exist anywhere",
    number: "4",
  });

  assert.deepEqual(queries, ['name:"Charizard" number:"4"', 'name:"Charizard"']);
});

test("normalizeCollectorNumber keeps plain and split collector numbers useful for search", () => {
  assert.equal(normalizeCollectorNumber("199/165"), "199");
  assert.equal(normalizeCollectorNumber("TG05/TG30"), "TG05");
  assert.equal(normalizeCollectorNumber("42"), "42");
});

test("normalizeCollectorNumber strips leading zeros from pure-digit numbers but preserves alphanumeric codes", () => {
  // The live API stores pure-digit collector numbers without leading
  // zeros across every era we checked (vintage and modern), but
  // alphanumeric-prefixed numbers like Trainer Gallery cards keep their
  // padding as part of the code.
  assert.equal(normalizeCollectorNumber("04/102"), "4");
  assert.equal(normalizeCollectorNumber("04"), "4");
  assert.equal(normalizeCollectorNumber("0042"), "42");
  assert.equal(normalizeCollectorNumber("TG05/TG30"), "TG05");
  assert.equal(normalizeCollectorNumber("SWSH001"), "SWSH001");
});

test("mapPokemonTcgCard maps catalog fields and reconstructs full collector number", () => {
  const card = mapPokemonTcgCard({
    id: "sv3pt5-199",
    name: "Charizard ex",
    number: "199",
    rarity: "Special Illustration Rare",
    images: {
      small: "https://images.pokemontcg.io/sv3pt5/199.png",
      large: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
    },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/sv3pt5-199",
      updatedAt: "2026/06/20",
      prices: {
        holofoil: {
          low: 182.5,
          mid: 220,
          market: 205.2,
        },
      },
    },
    cardmarket: {
      url: "https://prices.pokemontcg.io/cardmarket/sv3pt5-199",
      updatedAt: "2026/06/20",
      prices: {
        trendPrice: 198.75,
        averageSellPrice: 203.1,
        lowPriceExPlus: 170,
      },
    },
    set: {
      id: "sv3pt5",
      name: "Scarlet & Violet 151",
      printedTotal: 165,
      images: {
        logo: "https://images.pokemontcg.io/sv3pt5/logo.png",
        symbol: "https://images.pokemontcg.io/sv3pt5/symbol.png",
      },
    },
  });

  assert.equal(card?.tcgApiId, "sv3pt5-199");
  assert.equal(card?.setCode, "sv3pt5");
  assert.equal(card?.number, "199/165");
  assert.equal(card?.imageUrl, "https://images.pokemontcg.io/sv3pt5/199_hires.png");
  assert.equal(card?.setLogoUrl, "https://images.pokemontcg.io/sv3pt5/logo.png");
  assert.equal(card?.setSymbolUrl, "https://images.pokemontcg.io/sv3pt5/symbol.png");

  const bestSignal = pickCatalogPriceSignal(card?.priceSignals);
  assert.equal(bestSignal?.source, "cardmarket");
  assert.equal(bestSignal?.kind, "trendPrice");
  assert.equal(bestSignal?.pricePence, Math.round((198.75 / 1.17) * 100));
  assert.ok(card?.priceSignals?.some((signal) => signal.source === "tcgplayer" && signal.kind === "market"));
});

test("PokemonTcgApiCatalogSource searches cards and sends API key header when present", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: URL, init?: RequestInit) => {
    calls.push({ url: url.toString(), headers: init?.headers as Record<string, string> });
    return {
      ok: true,
      async json() {
        return {
          data: [
            {
              id: "sv3pt5-006",
              name: "Charizard ex",
              number: "006",
              set: { id: "sv3pt5", name: "Scarlet & Violet 151", printedTotal: 165 },
            },
            {
              id: "sv3pt5-199",
              name: "Charizard ex",
              number: "199",
              images: { small: "small.png" },
              set: { id: "sv3pt5", name: "Scarlet & Violet 151", printedTotal: 165 },
            },
          ],
        };
      },
    } as Response;
  }) as typeof fetch;

  const source = new PokemonTcgApiCatalogSource("secret", fetchImpl, "https://api.example.test/v2");
  const card = await source.resolve({ name: "Charizard ex", setName: "151", number: "199/165" });

  assert.equal(card?.tcgApiId, "sv3pt5-199");
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.url.startsWith("https://api.example.test/v2/cards?"));
  assert.equal(
    new URL(calls[0]?.url ?? "").searchParams.get("q"),
    'name:"Charizard ex" number:"199" set.id:sv3pt5',
  );
  assert.equal(calls[0]?.headers["X-Api-Key"], "secret");
});

test("PokemonTcgApiCatalogSource falls back to looser queries when the most specific one returns no results", async () => {
  const queriesSeen: string[] = [];
  const fetchImpl = (async (url: URL) => {
    const q = url.searchParams.get("q") ?? "";
    queriesSeen.push(q);
    const hasNumber = q.includes("number:");
    return {
      ok: true,
      async json() {
        if (hasNumber) {
          // Simulates the most specific level finding nothing -- e.g. the
          // number term didn't line up with how the API stores it.
          return { data: [] };
        }
        return {
          data: [
            {
              id: "base1-4",
              name: "Charizard",
              number: "4",
              set: { id: "base1", name: "Base", printedTotal: 102 },
            },
          ],
        };
      },
    } as Response;
  }) as typeof fetch;

  const source = new PokemonTcgApiCatalogSource(undefined, fetchImpl, "https://api.example.test/v2");
  const card = await source.resolve({ name: "Charizard", setName: "base set", number: "04/102" });

  assert.equal(card?.tcgApiId, "base1-4");
  assert.equal(card?.number, "4/102");
  assert.equal(queriesSeen[0], 'name:"Charizard" number:"4" set.id:base1');
  assert.equal(queriesSeen[1], 'name:"Charizard" set.id:base1');
});

test("PokemonTcgApiCatalogSource fetches by tcgApiId when supplied", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: URL) => {
    calls.push(url.toString());
    return {
      ok: true,
      async json() {
        return {
          data: {
            id: "sv3pt5-199",
            name: "Charizard ex",
            number: "199",
            set: { id: "sv3pt5", name: "Scarlet & Violet 151", printedTotal: 165 },
          },
        };
      },
    } as Response;
  }) as typeof fetch;

  const source = new PokemonTcgApiCatalogSource(undefined, fetchImpl, "https://api.example.test/v2");
  const card = await source.resolve({ name: "Charizard ex", tcgApiId: "sv3pt5-199" });

  assert.equal(card?.number, "199/165");
  assert.equal(
    calls[0],
    "https://api.example.test/v2/cards/sv3pt5-199?select=id%2Cname%2Cnumber%2Crarity%2Cimages%2Cset%2Ctcgplayer%2Ccardmarket",
  );
});
