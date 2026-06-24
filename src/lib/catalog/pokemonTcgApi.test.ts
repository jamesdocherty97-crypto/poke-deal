import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPokemonTcgCollectorNumberTerms,
  buildPokemonTcgIdCandidates,
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

test("buildPokemonTcgSearchQueries strips first-edition dealer qualifiers for catalog lookup", () => {
  assert.deepEqual(
    buildPokemonTcgSearchQueries({
      name: "Hitmontop 1st Edition",
      setName: "Neo Genesis",
    }).slice(0, 2),
    ['name:"Hitmontop" set.id:neo1', 'name:"Hitmontop"'],
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

test("buildPokemonTcgSearchQueries uses prefixed numbers to resolve attached gallery subsets", () => {
  const queries = buildPokemonTcgSearchQueries({
    name: "Gengar",
    setName: "Lost Origin",
    number: "TG06/TG30",
  });

  assert.deepEqual(queries, [
    'name:"Gengar" number:"TG06" set.id:swsh11tg',
    'name:"Gengar" set.id:swsh11tg',
    'name:"Gengar" number:"TG06"',
    'name:"Gengar"',
  ]);
});

test("buildPokemonTcgSearchQueries tries API-style promo numbers after printed promo codes", () => {
  const queries = buildPokemonTcgSearchQueries({
    name: "Pikachu with Grey Felt Hat",
    setName: "SV Promos",
    number: "SVP085",
  });

  assert.deepEqual(queries.slice(0, 6), [
    'name:"Pikachu with Grey Felt Hat" number:"SVP085" set.id:svp',
    'name:"Pikachu with Grey Felt Hat" number:"85" set.id:svp',
    'name:pikachu number:"SVP085" set.id:svp',
    'name:pikachu number:"85" set.id:svp',
    'name:"Pikachu with Grey Felt Hat" set.id:svp',
    'name:pikachu set.id:svp',
  ]);
});

test("buildPokemonTcgSearchQueries keeps unavailable promo sets strict", () => {
  const queries = buildPokemonTcgSearchQueries({
    name: "Snivy",
    setName: "MEP",
    number: "MEP049",
  });

  assert.deepEqual(queries, [
    'name:"Snivy" number:"MEP049" set.id:mep',
    'name:"Snivy" number:"49" set.id:mep',
    'name:"Snivy" set.id:mep',
  ]);
});

test("buildPokemonTcgSearchQueries keeps future promo prefixes from falling back to name-only", () => {
  assert.deepEqual(
    buildPokemonTcgSearchQueries({
      name: "Snivy",
      setName: "Future Promos",
      number: "XYZ001",
    }),
    ['name:"Snivy" number:"XYZ001"'],
  );

  assert.deepEqual(
    buildPokemonTcgSearchQueries({
      name: "Snivy",
      number: "XYZ001",
    }),
    ['name:"Snivy" number:"XYZ001"'],
  );
});

test("buildPokemonTcgSearchQueries drops the set term entirely when it can't be resolved", () => {
  const queries = buildPokemonTcgSearchQueries({
    name: "Charizard",
    setName: "some set that does not exist anywhere",
    number: "4",
  });

  assert.deepEqual(queries, ['name:"Charizard" number:"4"', 'name:"Charizard"']);
});

test("buildPokemonTcgCollectorNumberTerms keeps printed codes and adds stripped API promo numbers", () => {
  assert.deepEqual(buildPokemonTcgCollectorNumberTerms("SVP085"), ["SVP085", "85"]);
  assert.deepEqual(buildPokemonTcgCollectorNumberTerms("MEP049"), ["MEP049", "49"]);
  assert.deepEqual(buildPokemonTcgCollectorNumberTerms("SWSH262"), ["SWSH262"]);
  assert.deepEqual(buildPokemonTcgCollectorNumberTerms("TG06/TG30"), ["TG06"]);
  assert.deepEqual(buildPokemonTcgCollectorNumberTerms("214/167"), ["214"]);
});

test("buildPokemonTcgIdCandidates builds exact set-number ids before search", () => {
  assert.deepEqual(
    buildPokemonTcgIdCandidates({
      name: "Gengar",
      setName: "Lost Origin Trainer Gallery",
      number: "TG06/TG30",
    }),
    ["swsh11tg-TG06"],
  );
  assert.deepEqual(
    buildPokemonTcgIdCandidates({
      name: "Pikachu with Grey Felt Hat",
      setName: "SV Promos",
      number: "SVP085",
    }),
    ["svp-SVP085", "svp-85"],
  );
  assert.deepEqual(
    buildPokemonTcgIdCandidates({
      name: "Snivy",
      setName: "MEP",
      number: "MEP049",
    }),
    ["mep-MEP049", "mep-49"],
  );
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

test("mapPokemonTcgCard preserves printed prefixed subset collector numbers", () => {
  const card = mapPokemonTcgCard({
    id: "swsh11tg-TG06",
    name: "Gengar",
    number: "TG06",
    rarity: "Trainer Gallery Rare Holo",
    images: {
      large: "https://images.pokemontcg.io/swsh11tg/TG06_hires.png",
    },
    set: {
      id: "swsh11tg",
      name: "Lost Origin Trainer Gallery",
      printedTotal: 30,
    },
  });

  assert.equal(card?.tcgApiId, "swsh11tg-TG06");
  assert.equal(card?.setCode, "swsh11tg");
  assert.equal(card?.number, "TG06/TG30");
  assert.equal(card?.imageUrl, "https://images.pokemontcg.io/swsh11tg/TG06_hires.png");
});

test("mapPokemonTcgCard formats Scarlet & Violet promo numbers as dealer-entered SVP codes", () => {
  const card = mapPokemonTcgCard({
    id: "svp-85",
    name: "Pikachu with Grey Felt Hat",
    number: "85",
    rarity: "Promo",
    images: {
      large: "https://images.pokemontcg.io/svp/85_hires.png",
    },
    set: {
      id: "svp",
      name: "Scarlet & Violet Black Star Promos",
      printedTotal: 215,
    },
  });

  assert.equal(card?.tcgApiId, "svp-85");
  assert.equal(card?.number, "SVP085");
  assert.equal(card?.setCode, "svp");
});

test("mapPokemonTcgCard formats Mega Evolution promo numbers as dealer-entered MEP codes", () => {
  const card = mapPokemonTcgCard({
    id: "mep-49",
    name: "Snivy",
    number: "49",
    rarity: "Promo",
    images: {
      large: "https://images.pokemontcg.io/mep/49_hires.png",
    },
    set: {
      id: "mep",
      name: "Mega Evolution Promos",
    },
  });

  assert.equal(card?.tcgApiId, "mep-49");
  assert.equal(card?.number, "MEP049");
  assert.equal(card?.setCode, "mep");
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
  const card = await source.resolve({ name: "Charizard ex", setName: "151" });

  assert.equal(card?.tcgApiId, "sv3pt5-006");
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.url.startsWith("https://api.example.test/v2/cards?"));
  assert.equal(
    new URL(calls[0]?.url ?? "").searchParams.get("q"),
    'name:"Charizard ex" set.id:sv3pt5',
  );
  assert.equal(calls[0]?.headers["X-Api-Key"], "secret");
});

test("PokemonTcgApiCatalogSource resolves known set-number cards by deterministic id first", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: URL) => {
    calls.push(url.toString());
    return {
      ok: true,
      async json() {
        return {
          data: {
            id: "swsh11tg-TG06",
            name: "Gengar",
            number: "TG06",
            images: { large: "gengar.png" },
            set: { id: "swsh11tg", name: "Lost Origin Trainer Gallery", printedTotal: 30 },
          },
        };
      },
    } as Response;
  }) as typeof fetch;

  const source = new PokemonTcgApiCatalogSource(undefined, fetchImpl, "https://api.example.test/v2");
  const card = await source.resolve({
    name: "Gengar",
    setName: "Lost Origin",
    number: "TG06/TG30",
  });

  assert.equal(card?.tcgApiId, "swsh11tg-TG06");
  assert.equal(card?.number, "TG06/TG30");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0],
    "https://api.example.test/v2/cards/swsh11tg-TG06?select=id%2Cname%2Cnumber%2Crarity%2Cimages%2Cset%2Ctcgplayer%2Ccardmarket",
  );
});

test("PokemonTcgApiCatalogSource falls back to looser queries when the most specific one returns no results", async () => {
  const queriesSeen: string[] = [];
  const fetchImpl = (async (url: URL) => {
    if (!url.searchParams.has("q")) {
      return { ok: false, async json() { return {}; } } as Response;
    }
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

test("PokemonTcgApiCatalogSource searches and ranks multiple cards", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    async json() {
      return {
        data: [
          {
            id: "swsh4-25",
            name: "Charizard",
            number: "25",
            set: { id: "swsh4", name: "Vivid Voltage", printedTotal: 185 },
          },
          {
            id: "base1-4",
            name: "Charizard",
            number: "4",
            set: { id: "base1", name: "Base", printedTotal: 102 },
          },
        ],
      };
    },
  }) as Response) as typeof fetch;

  const source = new PokemonTcgApiCatalogSource(undefined, fetchImpl, "https://api.example.test/v2");
  const cards = await source.search({ name: "Charizard", setName: "base set" }, 5);

  assert.equal(cards[0]?.tcgApiId, "base1-4");
  assert.equal(cards[0]?.number, "4/102");
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

test("PokemonTcgApiCatalogSource caches metadata-only search responses and uses timeout signals", async () => {
  let calls = 0;
  const fetchImpl = (async (url: URL, init?: RequestInit) => {
    calls += 1;
    assert.ok(init?.signal, "catalog requests should carry a timeout signal");
    assert.equal(url.searchParams.get("select"), "id,name,number,rarity,images,set");
    return {
      ok: true,
      async json() {
        return {
          data: [
            {
              id: "cache-test-card",
              name: "Cache Test Card",
              number: "1",
              set: { id: "base1", name: "Base", printedTotal: 102 },
            },
          ],
        };
      },
    } as Response;
  }) as typeof fetch;

  const source = new PokemonTcgApiCatalogSource("secret", fetchImpl);
  const card = { name: "Cache Test Card" };

  const first = await source.search(card);
  const second = await source.search(card);

  assert.equal(first[0]?.tcgApiId, "cache-test-card");
  assert.equal(second[0]?.tcgApiId, "cache-test-card");
  assert.equal(calls, 1);
});

test("PokemonTcgApiCatalogSource does not cache price-bearing resolve responses", async () => {
  let calls = 0;
  const fetchImpl = (async (url: URL, init?: RequestInit) => {
    calls += 1;
    assert.ok(init?.signal, "catalog requests should carry a timeout signal");
    assert.equal(url.searchParams.get("select"), "id,name,number,rarity,images,set,tcgplayer,cardmarket");
    return {
      ok: true,
      async json() {
        return {
          data: {
            id: "fresh-price-card",
            name: "Fresh Price Card",
            number: "1",
            set: { id: "base1", name: "Base", printedTotal: 102 },
            tcgplayer: {
              updatedAt: "2026/06/23",
              prices: { normal: { market: calls } },
            },
          },
        };
      },
    } as Response;
  }) as typeof fetch;

  const source = new PokemonTcgApiCatalogSource("secret", fetchImpl);
  const first = await source.resolve({ name: "Fresh Price Card", tcgApiId: "fresh-price-card" });
  const second = await source.resolve({ name: "Fresh Price Card", tcgApiId: "fresh-price-card" });

  assert.equal(calls, 2);
  assert.equal(first?.priceSignals?.find((signal) => signal.kind === "market")?.originalAmount, 1);
  assert.equal(second?.priceSignals?.find((signal) => signal.kind === "market")?.originalAmount, 2);
});
