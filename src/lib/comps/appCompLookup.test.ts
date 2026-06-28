import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogToCardRef,
  findAmbiguousCatalogCandidates,
  findCatalogAlternatives,
  findVariantSiblings,
  refreshCachedCatalogPriceSignals,
  requestHasExplicitCardNumber,
  resolveCatalogCard,
} from "./appCompLookup.js";
import type { PokemonTcgApiCatalogSource } from "../catalog/pokemonTcgApi.js";
import type { CatalogCard } from "../catalog/types.js";
import type { CardRef } from "../domain/types.js";

test("resolveCatalogCard falls back through catalogue search and refreshes the chosen card by id", async () => {
  const searchedCard: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Pikachu with Grey Felt Hat",
    setName: "Scarlet & Violet Black Star Promos",
    setCode: "svp",
    number: "SVP085",
    tcgApiId: "svp-85",
  };
  const pricedCard: CatalogCard = {
    ...searchedCard,
    imageUrl: "https://images.pokemontcg.io/svp/85_hires.png",
    priceSignals: [
      {
        source: "cardmarket",
        label: "Cardmarket Trend Price",
        pricePence: 8700,
        originalAmount: 101.79,
        originalCurrency: "EUR",
        kind: "trendPrice",
      },
    ],
  };

  const calls: string[] = [];
  const source = {
    async resolve(card: CardRef) {
      calls.push(`resolve:${card.tcgApiId ?? "freeform"}`);
      return card.tcgApiId === "svp-85" ? pricedCard : null;
    },
    async search(card: CardRef) {
      calls.push(`search:${card.name}`);
      return [searchedCard];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Pikachu with Grey Felt Hat", setName: "SV Promos", number: "SVP085" },
    source,
  );

  assert.deepEqual(calls, [
    "resolve:freeform",
    "search:Pikachu with Grey Felt Hat",
    "resolve:svp-85",
  ]);
  assert.equal(resolved?.tcgApiId, "svp-85");
  assert.equal(resolved?.priceSignals?.[0]?.pricePence, 8700);
});

test("catalogToCardRef preserves first-edition intent after catalog canonicalization", () => {
  const catalog: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Lugia",
    setName: "Neo Genesis",
    setCode: "neo1",
    number: "9/111",
    tcgApiId: "neo1-9",
  };

  const card = catalogToCardRef(catalog, { name: "Lugia 1st Edition", setName: "Neo Genesis" });

  assert.equal(card.name, "Lugia 1st Edition");
  assert.equal(card.setName, "Neo Genesis");
  assert.equal(card.number, "9/111");
  assert.equal(card.tcgApiId, "neo1-9");
});

test("resolveCatalogCard falls back to known chase-card metadata when live catalog misses", async () => {
  const calls: string[] = [];
  const source = {
    async resolve(card: CardRef) {
      calls.push(`resolve:${card.tcgApiId ?? "freeform"}`);
      return null;
    },
    async search(card: CardRef) {
      calls.push(`search:${card.name}`);
      return [];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Mew ex", setName: "Paldean Fates", number: "232/091" },
    source,
  );

  assert.deepEqual(calls, ["resolve:freeform", "search:Mew ex", "resolve:sv4pt5-232"]);
  assert.equal(resolved?.tcgApiId, "sv4pt5-232");
  assert.equal(resolved?.imageUrl, "https://images.pokemontcg.io/sv4pt5/232_hires.png");
});

test("resolveCatalogCard rejects same-name cards from the wrong requested set", async () => {
  const wrongSetCard: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Hitmontop",
    setName: "Neo Discovery",
    setCode: "neo2",
    number: "3/75",
    tcgApiId: "neo2-3",
  };
  const source = {
    async resolve() {
      return wrongSetCard;
    },
    async search() {
      return [wrongSetCard];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Hitmontop", setName: "Neo Genesis", number: "3/111" },
    source,
  );

  assert.equal(resolved, null);
});

test("resolveCatalogCard can time out slow catalog misses", async () => {
  const source = {
    async resolve() {
      return new Promise<CatalogCard | null>(() => undefined);
    },
    async search() {
      return [];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const started = Date.now();
  const resolved = await resolveCatalogCard(
    { name: "Mew ex", setName: "Wrong Set", number: "232/091" },
    source,
    { timeoutMs: 10 },
  );

  assert.equal(resolved, null);
  assert.ok(Date.now() - started < 500, "slow catalog resolution should not block the comp flow");
});

test("resolveCatalogCard uses known chase metadata when live catalog times out", async () => {
  const source = {
    async resolve() {
      return new Promise<CatalogCard | null>(() => undefined);
    },
    async search() {
      return new Promise<CatalogCard[]>(() => undefined);
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const started = Date.now();
  const resolved = await resolveCatalogCard(
    { name: "Charizard ex", setName: "151", number: "199/165" },
    source,
    { timeoutMs: 10 },
  );

  assert.ok(Date.now() - started < 500, "slow catalog resolution should not block the comp flow");
  assert.equal(resolved?.tcgApiId, "sv3pt5-199");
  assert.equal(resolved?.imageUrl, "https://images.pokemontcg.io/sv3pt5/199_hires.png");
});

test("resolveCatalogCard can fall back to known promo metadata", async () => {
  const source = {
    async resolve() {
      return null;
    },
    async search() {
      return [];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Pikachu with Grey Felt Hat", setName: "SV Promos", number: "SVP085" },
    source,
  );

  assert.equal(resolved?.tcgApiId, "svp-85");
  assert.equal(resolved?.number, "SVP085");
  assert.equal(resolved?.imageUrl, "https://images.pokemontcg.io/svp/85_hires.png");
});

test("resolveCatalogCard can fall back to modern promo metadata before live catalog catches up", async () => {
  const source = {
    async resolve() {
      return null;
    },
    async search() {
      return [];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Snivy", setName: "Mega Evolution Promos", number: "MEP049" },
    source,
  );

  assert.equal(resolved?.name, "Snivy");
  assert.equal(resolved?.setName, "Mega Evolution Promos");
  assert.equal(resolved?.setCode, "mep");
  assert.equal(resolved?.number, "MEP049");
  assert.equal(resolved?.tcgApiId, "mep-49");
  assert.equal(resolved?.imageUrl, undefined);
});

test("resolveCatalogCard creates a future promo identity when the live catalog has not caught up", async () => {
  const source = {
    async resolve() {
      return null;
    },
    async search() {
      return [];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Victini", setName: "SV Promos", number: "SVP208" },
    source,
  );

  assert.equal(resolved?.name, "Victini");
  assert.equal(resolved?.setName, "Scarlet & Violet Black Star Promos");
  assert.equal(resolved?.setCode, "svp");
  assert.equal(resolved?.number, "SVP208");
  assert.equal(resolved?.tcgApiId, "svp-208");
  assert.equal(resolved?.imageUrl, undefined);
});

test("resolveCatalogCard preserves typed future promo padding", async () => {
  const source = {
    async resolve() {
      return null;
    },
    async search() {
      return [];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Alakazam", setName: "Mega Evolution Promos", number: "MEP0079" },
    source,
  );

  assert.equal(resolved?.number, "MEP0079");
  assert.equal(resolved?.tcgApiId, "mep-79");
});

test("findCatalogAlternatives returns safe wrong-set recovery candidates", async () => {
  const wrongSetCard: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Hitmontop",
    setName: "Neo Discovery",
    setCode: "neo2",
    number: "3/75",
    imageUrl: "https://images.pokemontcg.io/neo2/3_hires.png",
    tcgApiId: "neo2-3",
  };
  const wrongNameCard: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Bellossom",
    setName: "Neo Genesis",
    setCode: "neo1",
    number: "3/111",
    tcgApiId: "neo1-3",
  };
  const source = {
    async search() {
      return [wrongNameCard, wrongSetCard, wrongSetCard];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const alternatives = await findCatalogAlternatives(
    { name: "Hitmontop 1st Edition", setName: "Neo Genesis", number: "3/111" },
    source,
  );

  assert.deepEqual(alternatives, [wrongSetCard]);
});

test("findCatalogAlternatives falls back to bundled alternatives when live catalog is slow", async () => {
  const source = {
    async search() {
      return new Promise<CatalogCard[]>(() => undefined);
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const started = Date.now();
  const alternatives = await findCatalogAlternatives(
    { name: "Mew ex", setName: "Wrong Set", number: "232/091" },
    source,
    4,
    { timeoutMs: 10 },
  );

  assert.ok(Date.now() - started < 500, "slow live catalog should not block recovery alternatives");
  assert.equal(alternatives.some((card) => card.name === "Mew ex" && card.number === "232/091"), true);
});

test("resolveCatalogCard rejects same-set cards when the requested name differs", async () => {
  const wrongCard: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Bellossom",
    setName: "Neo Genesis",
    setCode: "neo1",
    number: "3/111",
    tcgApiId: "neo1-3",
  };
  const source = {
    async resolve() {
      return wrongCard;
    },
    async search() {
      return [wrongCard];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Hitmontop", setName: "Neo Genesis", number: "3/111" },
    source,
  );

  assert.equal(resolved, null);
});

test("resolveCatalogCard resolves a selected tcgApiId directly before text fallback", async () => {
  const selected: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Zapdos ex",
    setName: "151",
    number: "192/165",
    tcgApiId: "sv3pt5-192",
  };
  const wrongTextFallback: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Zapdos ex",
    setName: "151",
    number: "145/165",
    tcgApiId: "sv3pt5-145",
  };
  const calls: string[] = [];
  const source = {
    async resolve(card: CardRef) {
      calls.push(`resolve:${card.tcgApiId ?? "freeform"}`);
      return card.tcgApiId === "sv3pt5-192" ? selected : wrongTextFallback;
    },
    async search() {
      calls.push("search");
      return [wrongTextFallback];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Zapdos ex", setName: "151", number: "192/165", tcgApiId: "sv3pt5-192" },
    source,
  );

  assert.deepEqual(calls, ["resolve:sv3pt5-192"]);
  assert.equal(resolved?.tcgApiId, "sv3pt5-192");
});

test("findAmbiguousCatalogCandidates returns matching variants for a bare same-set search", async () => {
  const umbreonV: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Umbreon V",
    setName: "Evolving Skies",
    number: "94/203",
    tcgApiId: "swsh7-94",
  };
  const umbreonVmax: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Umbreon VMAX",
    setName: "Evolving Skies",
    number: "95/203",
    tcgApiId: "swsh7-95",
  };
  const moonbreon: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Umbreon VMAX",
    setName: "Evolving Skies",
    number: "215/203",
    tcgApiId: "swsh7-215",
  };
  const source = {
    async search() {
      return [umbreonV, umbreonVmax, moonbreon];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const candidates = await findAmbiguousCatalogCandidates(
    { name: "Umbreon", setName: "Evolving Skies" },
    source,
  );

  assert.deepEqual(new Set(candidates.map((card) => card.tcgApiId)), new Set(["swsh7-94", "swsh7-95", "swsh7-215"]));
});

test("findAmbiguousCatalogCandidates skips exact-number and selected-id lookups", async () => {
  let searchCalls = 0;
  const source = {
    async search() {
      searchCalls += 1;
      return [];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  assert.deepEqual(
    await findAmbiguousCatalogCandidates({ name: "Zapdos ex", setName: "151", number: "192/165" }, source),
    [],
  );
  assert.deepEqual(
    await findAmbiguousCatalogCandidates({ name: "Zapdos ex", setName: "151", tcgApiId: "sv3pt5-192" }, source),
    [],
  );
  assert.equal(searchCalls, 0);
});

test("requestHasExplicitCardNumber recognises a separate number field and embedded collector numbers", () => {
  assert.equal(requestHasExplicitCardNumber({ name: "Charizard ex", setName: "151", number: "199/165" }), true);
  assert.equal(requestHasExplicitCardNumber({ name: "Zapdos 192", setName: "151" }), true);
  assert.equal(requestHasExplicitCardNumber({ name: "Umbreon", setName: "Evolving Skies" }), false);
  assert.equal(requestHasExplicitCardNumber({ name: "Umbreon VMAX", setName: "Evolving Skies" }), false);
});

test("findVariantSiblings surfaces same-set V/VMAX/alt-art siblings when no number was given", () => {
  const umbreonV: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Umbreon V",
    setName: "Evolving Skies",
    number: "94",
    tcgApiId: "swsh7-94",
  };
  const umbreonVmax: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Umbreon VMAX",
    setName: "Evolving Skies",
    number: "95",
    tcgApiId: "swsh7-95",
  };
  const moonbreon: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Umbreon VMAX",
    setName: "Evolving Skies",
    number: "215",
    tcgApiId: "swsh7-215",
  };
  const unrelatedSet: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Umbreon VMAX",
    setName: "Brilliant Stars",
    number: "121",
    tcgApiId: "swsh9-121",
  };
  const unrelatedName: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Espeon V",
    setName: "Evolving Skies",
    number: "189",
    tcgApiId: "swsh7-189-espeon",
  };

  const siblings = findVariantSiblings(umbreonV, [umbreonV, umbreonVmax, moonbreon, unrelatedSet, unrelatedName]);

  assert.deepEqual(siblings, [umbreonVmax, moonbreon]);
});

test("findVariantSiblings catches same-name reprints that differ only by number (e.g. regular vs SIR)", () => {
  const regular: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Charizard ex",
    setName: "151",
    number: "6",
    tcgApiId: "sv3pt5-6",
  };
  const specialIllustrationRare: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Charizard ex",
    setName: "151",
    number: "199/165",
    tcgApiId: "sv3pt5-199",
  };

  const siblings = findVariantSiblings(regular, [regular, specialIllustrationRare]);

  assert.deepEqual(siblings, [specialIllustrationRare]);
});

test("refreshCachedCatalogPriceSignals re-resolves a DB-cached identity (no price signals) by id to pick up live prices", async () => {
  const cachedIdentity: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Blastoise-EX",
    setName: "Evolutions",
    setCode: "xy12",
    number: "21/108",
    tcgApiId: "xy12-21",
    // No priceSignals -- this is exactly what findCachedCatalogMatch returns,
    // since the local Card table only stores identity, not live prices.
  };
  const priced: CatalogCard = {
    ...cachedIdentity,
    priceSignals: [
      {
        source: "cardmarket",
        label: "Cardmarket Trend Price",
        pricePence: 783,
        originalAmount: 7.83,
        originalCurrency: "EUR",
        kind: "trendPrice",
      },
    ],
  };
  const calls: string[] = [];
  const source = {
    name: "pokemon-tcg-api",
    live: true,
    async resolve(card: CardRef) {
      calls.push(`resolve:${card.tcgApiId}`);
      return priced;
    },
  };

  const refreshed = await refreshCachedCatalogPriceSignals(
    cachedIdentity,
    { name: "Blastoise-EX", setName: "Evolutions", number: "21/108" },
    source,
  );

  assert.deepEqual(calls, ["resolve:xy12-21"]);
  assert.equal(refreshed.priceSignals?.[0]?.pricePence, 783);
});

test("refreshCachedCatalogPriceSignals skips the live refresh when the cached entry already carries price signals", async () => {
  const alreadyPriced: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Charizard ex",
    setName: "151",
    number: "6",
    tcgApiId: "sv3pt5-6",
    priceSignals: [
      {
        source: "tcgplayer",
        label: "TCGPlayer Holofoil market",
        pricePence: 1417,
        originalAmount: 18,
        originalCurrency: "USD",
        kind: "market",
      },
    ],
  };
  let resolveCalled = false;
  const source = {
    name: "pokemon-tcg-api",
    live: true,
    async resolve() {
      resolveCalled = true;
      return null;
    },
  };

  const refreshed = await refreshCachedCatalogPriceSignals(
    alreadyPriced,
    { name: "Charizard ex", setName: "151", number: "6" },
    source,
  );

  assert.equal(resolveCalled, false);
  assert.deepEqual(refreshed, alreadyPriced);
});

test("refreshCachedCatalogPriceSignals falls back to the cached identity untouched when the live refresh fails or is empty", async () => {
  const cachedIdentity: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Blastoise-EX",
    setName: "Evolutions",
    number: "21/108",
    tcgApiId: "xy12-21",
  };

  const timeoutSource = {
    name: "pokemon-tcg-api",
    live: true,
    async resolve() {
      throw new Error("rate limited");
    },
  };
  const emptySource = {
    name: "pokemon-tcg-api",
    live: true,
    async resolve() {
      return null;
    },
  };

  assert.deepEqual(
    await refreshCachedCatalogPriceSignals(cachedIdentity, { name: "Blastoise-EX" }, timeoutSource),
    cachedIdentity,
  );
  assert.deepEqual(
    await refreshCachedCatalogPriceSignals(cachedIdentity, { name: "Blastoise-EX" }, emptySource),
    cachedIdentity,
  );
});

test("findVariantSiblings returns nothing when the resolved card has no same-set siblings", () => {
  const onlyPrinting: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Hitmontop",
    setName: "Neo Genesis",
    number: "3/111",
    tcgApiId: "neo1-3",
  };
  const differentPokemon: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Bellossom",
    setName: "Neo Genesis",
    number: "4/111",
    tcgApiId: "neo1-4",
  };

  assert.deepEqual(findVariantSiblings(onlyPrinting, [differentPokemon]), []);
});
