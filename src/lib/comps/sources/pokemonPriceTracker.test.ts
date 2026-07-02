import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildGradeLadder,
  buildPokemonPriceTrackerSearch,
  buildPokemonPriceTrackerSearchVariants,
  gradeToProviderKey,
  mapCardAggregateToComp,
  normalizeProviderCollectorNumber,
  PokemonPriceTrackerSource,
  providerPayloadMatchesRequest,
} from "./pokemonPriceTracker.js";
import type { CardRef } from "../../domain/types.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/ppt-cards-ebay.json", import.meta.url)), "utf8"),
);

const card: CardRef = { name: "Charizard ex", number: "199/165", setName: "151" };
const ctx = (grade: any) => ({ source: "pokemon-price-tracker", card, grade, windowDays: 90 });

// USD→GBP at the static rate (1 GBP = 1.27 USD): pence = round(usd / 1.27 * 100)
const usdToPence = (usd: number) => Math.round((usd / 1.27) * 100);

test("gradeToProviderKey maps our grades to provider keys", () => {
  assert.equal(gradeToProviderKey("RAW"), "ungraded");
  assert.equal(gradeToProviderKey("PSA_10"), "psa10");
  assert.equal(gradeToProviderKey("PSA_9"), "psa9");
  assert.equal(gradeToProviderKey("BGS_9_5"), "bgs9_5");
  assert.equal(gradeToProviderKey("CGC_10"), "cgc10");
  assert.equal(gradeToProviderKey("ACE_10"), "ace10");
});

test("RAW prefers smartMarketPrice from noisy ungraded aggregate, converted to GBP", () => {
  assert.equal(Array.isArray(fixture.data), true, "captured v2 response should be array-shaped");
  assert.equal(fixture.metadata.limit, 1, "fixture should pin the low-credit request shape");
  const c = mapCardAggregateToComp(fixture, ctx("RAW"));
  assert.equal(c.currency, "GBP");
  assert.equal(c.sampleSize, 248);
  assert.equal(c.medianPence, usdToPence(392.5));
  assert.equal(c.meanPence, usdToPence(443.9269124423963));
  assert.equal(c.lowPence, usdToPence(2));
  assert.equal(c.highPence, usdToPence(1100));
  assert.equal(c.asOf, "2026-06-21T21:46:14.427Z");
  assert.equal((c.raw as { chosenPriceSource?: string; marketPrice7Day?: number }).chosenPriceSource, "smartMarketPrice");
  assert.equal((c.raw as { marketPrice7Day?: number }).marketPrice7Day, 453.7475);
});

test("buildPokemonPriceTrackerSearch expands prefixed subset numbers for provider matching", () => {
  assert.equal(
    buildPokemonPriceTrackerSearch({
      name: "Gengar",
      setName: "Lost Origin Trainer Gallery",
      number: "TG06/30",
    }),
    "Gengar TG06/TG30",
  );
  assert.equal(
    buildPokemonPriceTrackerSearch({
      name: "Gengar",
      setName: "Lost Origin",
      number: "TG06",
    }),
    "Gengar TG06/TG30",
  );
  assert.equal(normalizeProviderCollectorNumber("199/165", "151"), "199/165");
});

test("buildPokemonPriceTrackerSearch leaves promo-style prefixed numbers as printed", () => {
  assert.equal(
    buildPokemonPriceTrackerSearch({
      name: "Charizard VSTAR",
      setName: "SWSH Promos",
      number: "SWSH262",
    }),
    "Charizard VSTAR SWSH262",
  );
  assert.equal(
    buildPokemonPriceTrackerSearch({
      name: "Pikachu with Grey Felt Hat",
      setName: "SV Promos",
      number: "SVP085",
    }),
    "Pikachu with Grey Felt Hat SVP085",
  );
});

test("buildPokemonPriceTrackerSearch handles common gallery and shiny-vault inputs", () => {
  assert.equal(
    buildPokemonPriceTrackerSearch({
      name: "Giratina VSTAR",
      setName: "Crown Zenith",
      number: "GG69/70",
    }),
    "Giratina VSTAR GG69/GG70",
  );
  assert.equal(
    buildPokemonPriceTrackerSearch({
      name: "Charizard GX",
      setName: "Hidden Fates",
      number: "SV49",
    }),
    "Charizard GX SV49/SV94",
  );
  assert.equal(
    buildPokemonPriceTrackerSearch({
      name: "Umbreon VMAX",
      setName: "Brilliant Stars",
      number: "TG23",
    }),
    "Umbreon VMAX TG23/TG30",
  );
});

test("buildPokemonPriceTrackerSearchVariants fall back to collector number without printed total", () => {
  assert.deepEqual(
    buildPokemonPriceTrackerSearchVariants({
      name: "Mew ex",
      setName: "Paldean Fates",
      number: "232/091",
    }),
    ["Mew ex 232/091", "Mew ex 232", "Mew ex"],
  );
  assert.deepEqual(
    buildPokemonPriceTrackerSearchVariants({
      name: "Umbreon V",
      setName: "Evolving Skies",
      number: "94/203",
    }),
    ["Umbreon V 94/203", "Umbreon V 94", "Umbreon V 094/203", "Umbreon V 094", "Umbreon V"],
  );
});

test("PokemonPriceTrackerSource live requests use provider-style prefixed numbers", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 5);
  await source.lookup({ name: "Gengar", setName: "Lost Origin", number: "TG06/30" }, { grade: "RAW" });

  assert.ok(requestedUrls[0]);
  const requestedUrl = new URL(requestedUrls[0]);
  assert.equal(requestedUrl.searchParams.get("search"), "Gengar TG06/TG30");
  assert.equal(requestedUrl.searchParams.get("limit"), "1");
});

test("providerPayloadMatchesRequest validates fallback provider cards", () => {
  const celebrationReprint = {
    data: [
      {
        name: "Charizard",
        setName: "Celebrations: Classic Collection",
        cardNumber: "4/102",
      },
    ],
  };
  const giratinaGallery = {
    data: [
      {
        name: "Giratina VSTAR (Secret)",
        setName: "SWSH: Crown Zenith: Galarian Gallery",
        cardNumber: "GG69/GG70",
      },
    ],
  };
  const mewWithoutPrintedTotal = {
    data: [
      {
        name: "Mew ex",
        setName: "Paldean Fates",
        cardNumber: "232",
      },
    ],
  };
  const unlimitedVintage = {
    data: [
      {
        name: "Hitmontop",
        setName: "Neo Genesis",
        cardNumber: "3/111",
      },
    ],
  };
  const firstEditionVintage = {
    data: [
      {
        name: "Hitmontop 1st Edition",
        setName: "Neo Genesis",
        cardNumber: "3/111",
      },
    ],
  };

  assert.equal(
    providerPayloadMatchesRequest(celebrationReprint, { name: "Charizard", setName: "Base", number: "4/102" }),
    false,
  );
  assert.equal(
    providerPayloadMatchesRequest(giratinaGallery, {
      name: "Giratina VSTAR",
      setName: "Crown Zenith Galarian Gallery",
      number: "GG69/GG70",
    }),
    true,
  );
  assert.equal(
    providerPayloadMatchesRequest(mewWithoutPrintedTotal, {
      name: "Mew ex",
      setName: "Paldean Fates",
      number: "232/091",
    }),
    true,
  );
  assert.equal(
    providerPayloadMatchesRequest(unlimitedVintage, {
      name: "Hitmontop 1st Edition",
      setName: "Neo Genesis",
      number: "3/111",
    }),
    false,
  );
  assert.equal(
    providerPayloadMatchesRequest(firstEditionVintage, {
      name: "Hitmontop 1st Edition",
      setName: "Neo Genesis",
      number: "3/111",
    }),
    true,
  );

  assert.equal(
    providerPayloadMatchesRequest(
      {
        data: [
          {
            name: "Umbreon V",
            setName: "Evolving Skies",
            cardNumber: "94/203",
          },
        ],
      },
      { name: "Umbreon", setName: "Evolving Skies", number: "94/203" },
    ),
    true,
  );

  assert.equal(
    providerPayloadMatchesRequest(
      {
        data: [
          {
            name: "Umbreon V",
            cardNumber: "94/203",
          },
        ],
      },
      { name: "Umbreon", setName: "Evolving Skies", number: "94/203" },
    ),
    true,
  );

  assert.equal(
    providerPayloadMatchesRequest(
      {
        data: [
          {
            name: "Victini",
            setName: "Black Star Promos",
            cardNumber: "SVP208",
          },
        ],
      },
      {
        name: "Victini",
        setName: "Scarlet & Violet Black Star Promos",
        number: "SVP208",
      },
    ),
    true,
  );
});

test("PokemonPriceTrackerSource retries without a restrictive set filter", async () => {
  const requestedUrls: string[] = [];
  const fallbackPayload = {
    data: [
      {
        name: "Giratina VSTAR (Secret)",
        setName: "SWSH: Crown Zenith: Galarian Gallery",
        cardNumber: "GG69/GG70",
        ebay: {
          salesByGrade: {
            bgs9_5: {
              count: 2,
              averagePrice: 110,
              medianPrice: 100,
              minPrice: 90,
              maxPrice: 130,
              lastMarketUpdate: "2026-06-22T12:00:00.000Z",
            },
          },
        },
      },
    ],
  };
  const fetchImpl = (async (url: string | URL | Request) => {
    const urlString = String(url);
    requestedUrls.push(urlString);
    const requestedUrl = new URL(urlString);
    const payload = requestedUrl.searchParams.has("set") ? { data: [] } : fallbackPayload;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 5);
  const comp = await source.lookup(
    { name: "Giratina VSTAR", setName: "Crown Zenith Galarian Gallery", number: "GG69/GG70" },
    { grade: "BGS_9_5" },
  );

  assert.equal(requestedUrls.length, 2);
  assert.equal(new URL(requestedUrls[0]!).searchParams.get("set"), "Crown Zenith Galarian Gallery");
  assert.equal(new URL(requestedUrls[1]!).searchParams.has("set"), false);
  assert.equal(comp.sampleSize, 2);
  assert.equal(comp.medianPence, usdToPence(100));
});

test("PokemonPriceTrackerSource retries with collector number only before giving up", async () => {
  const requestedUrls: string[] = [];
  const fallbackPayload = {
    data: [
      {
        name: "Mew ex",
        setName: "Paldean Fates",
        cardNumber: "232",
        ebay: {
          salesByGrade: {
            ungraded: {
              count: 9,
              averagePrice: 104,
              medianPrice: 100,
              minPrice: 88,
              maxPrice: 120,
              smartMarketPrice: { price: 96, confidence: "medium", method: "filtered", daysUsed: 30 },
              lastMarketUpdate: "2026-06-22T12:00:00.000Z",
            },
          },
        },
      },
    ],
  };
  const fetchImpl = (async (url: string | URL | Request) => {
    const urlString = String(url);
    requestedUrls.push(urlString);
    const requestedUrl = new URL(urlString);
    const payload =
      requestedUrl.searchParams.get("search") === "Mew ex 232" && requestedUrl.searchParams.get("set") === "Paldean Fates"
        ? fallbackPayload
        : { data: [] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 5);
  const comp = await source.lookup({ name: "Mew ex", setName: "Paldean Fates", number: "232/091" }, { grade: "RAW" });

  assert.equal(requestedUrls.length, 3);
  assert.equal(new URL(requestedUrls[0]!).searchParams.get("search"), "Mew ex 232/091");
  assert.equal(new URL(requestedUrls[1]!).searchParams.get("search"), "Mew ex 232/091");
  assert.equal(new URL(requestedUrls[1]!).searchParams.has("set"), false);
  assert.equal(new URL(requestedUrls[2]!).searchParams.get("search"), "Mew ex 232");
  assert.equal(new URL(requestedUrls[2]!).searchParams.get("set"), "Paldean Fates");
  assert.equal(comp.sampleSize, 9);
  assert.equal(comp.medianPence, usdToPence(96));
});

test("PokemonPriceTrackerSource uses matching card returned alongside non-matching results", async () => {
  const payloads = {
    requested: {
      data: [
        {
          name: "Umbreon VMAX",
          setName: "Evolving Skies",
          cardNumber: "99/203",
          ebay: {
            salesByGrade: {
              ungraded: {
                count: 2,
                averagePrice: 20,
                medianPrice: 19,
                minPrice: 18,
                maxPrice: 22,
                smartMarketPrice: { price: 18, confidence: "low", method: "filtered", daysUsed: 30 },
                lastMarketUpdate: "2026-06-22T12:00:00.000Z",
              },
            },
          },
        },
        {
          name: "Umbreon",
          setName: "Evolving Skies",
          cardNumber: "94/203",
          ebay: {
            salesByGrade: {
              ungraded: {
                count: 7,
                averagePrice: 105,
                medianPrice: 100,
                minPrice: 90,
                maxPrice: 120,
                smartMarketPrice: { price: 98, confidence: "medium", method: "filtered", daysUsed: 30 },
                lastMarketUpdate: "2026-06-22T12:00:00.000Z",
              },
            },
          },
        },
      ],
    },
  };

  const fetchImpl = (async (_url: string | URL | Request) =>
    new Response(JSON.stringify(payloads.requested), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 5);
  const comp = await source.lookup({ name: "Umbreon", setName: "Evolving Skies", number: "94/203" }, { grade: "RAW" });

  assert.equal(comp.sampleSize, 7);
  assert.equal(comp.medianPence, usdToPence(98));
});

test("providerPayloadMatchesRequest supports matching any returned card, not just first", () => {
  const payload = {
    data: [
      {
        name: "Umbreon VMAX",
        setName: "Evolving Skies",
        cardNumber: "99/203",
      },
      {
        name: "Umbreon",
        setName: "Evolving Skies",
        cardNumber: "94/203",
      },
    ],
  };
  assert.equal(
    providerPayloadMatchesRequest(payload, { name: "Umbreon", setName: "Evolving Skies", number: "94/203", game: "POKEMON", language: "EN" }),
    true,
  );
});

test("mapCardAggregateToComp accepts a direct provider card object", () => {
  const directCard = {
    name: "Umbreon",
    setName: "Evolving Skies",
    cardNumber: "94/203",
    ebay: {
      salesByGrade: {
        ungraded: {
          count: 7,
          averagePrice: 105,
          medianPrice: 100,
          minPrice: 90,
          maxPrice: 120,
          smartMarketPrice: { price: 98, confidence: "medium", method: "filtered", daysUsed: 30 },
          lastMarketUpdate: "2026-06-22T12:00:00.000Z",
        },
      },
    },
  };
  const directResult = mapCardAggregateToComp(directCard, ctx("RAW"));
  assert.equal(directResult.sampleSize, 7);
  assert.equal(directResult.medianPence, usdToPence(98));
});

test("mapCardAggregateToComp derives trend from provider blended prices", () => {
  const directCard = {
    name: "Pikachu",
    setName: "Base Set",
    prices: {
      market: 100,
      trend: 120,
    },
    ebay: {
      salesByGrade: {
        ungraded: {
          count: 12,
          averagePrice: 120,
          medianPrice: 100,
          minPrice: 80,
          maxPrice: 160,
          lastMarketUpdate: "2026-06-22T12:00:00.000Z",
          marketPrice7Day: 111,
        },
      },
    },
  };

  const comp = mapCardAggregateToComp(directCard, ctx("RAW"));
  assert.equal(comp.trendPct, 11);
});

test("PokemonPriceTrackerSource accepts payload without set metadata when set context is present", async () => {
  const requestedUrls: string[] = [];
  const fallbackPayload = {
    data: [
      {
        name: "Umbreon",
        cardNumber: "94/204",
        ebay: {
          salesByGrade: {
            ungraded: {
              count: 7,
              averagePrice: 105,
              medianPrice: 100,
              minPrice: 90,
              maxPrice: 120,
              smartMarketPrice: { price: 98, confidence: "medium", method: "filtered", daysUsed: 30 },
              lastMarketUpdate: "2026-06-22T12:00:00.000Z",
            },
          },
        },
      },
    ],
  };
  const fetchImpl = (async (url: string | URL | Request) => {
    const urlString = String(url);
    requestedUrls.push(urlString);
    const requestedUrl = new URL(urlString);
    const payload = requestedUrl.searchParams.has("set") ? { data: [] } : fallbackPayload;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 5);
  const comp = await source.lookup({ name: "Umbreon", setName: "Evolving Skies", number: "94/204" }, { grade: "RAW" });

  assert.equal(requestedUrls.length, 2);
  assert.equal(new URL(requestedUrls[0]!).searchParams.get("set"), "Evolving Skies");
  assert.equal(new URL(requestedUrls[1]!).searchParams.has("set"), false);
  assert.equal(comp.sampleSize, 7);
});

test("PSA_10 maps from 'psa10' aggregate", () => {
  const c = mapCardAggregateToComp(fixture, ctx("PSA_10"));
  assert.equal(c.sampleSize, 249);
  assert.equal(c.medianPence, usdToPence(1349)); // ~106220
  assert.equal((c.raw as { smartMarketPrice?: { price?: number } }).smartMarketPrice?.price, 1508.12);
  assert.ok(c.medianPence > c.lowPence && c.highPence > c.medianPence);
});

test("PSA_9 maps from 'psa9' aggregate", () => {
  const c = mapCardAggregateToComp(fixture, ctx("PSA_9"));
  assert.equal(c.sampleSize, 336);
  assert.equal(c.medianPence, usdToPence(392.5));
});

test("BGS_9_5 and CGC_10 map from current live aggregate keys", () => {
  const bgs = mapCardAggregateToComp(fixture, ctx("BGS_9_5"));
  const cgc = mapCardAggregateToComp(fixture, ctx("CGC_10"));

  assert.equal(bgs.sampleSize, 27);
  assert.equal(bgs.medianPence, usdToPence(749.99));
  assert.equal(cgc.sampleSize, 69);
  assert.equal(cgc.medianPence, usdToPence(800));
});

test("buildGradeLadder projects every grade from one response into GBP pence", () => {
  const ladder = buildGradeLadder(fixture);
  const byGrade = Object.fromEntries(ladder.map((row) => [row.grade, row]));

  // All five buckets in the single salesByGrade block surface as ladder rows.
  assert.deepEqual(
    ladder.map((row) => row.grade).sort(),
    ["BGS_9_5", "CGC_10", "PSA_10", "PSA_9", "RAW"].sort(),
  );

  // RAW uses the filtered smart price (not the noisy ungraded median of 400).
  assert.equal(byGrade.RAW!.medianPence, usdToPence(392.5));
  assert.equal(byGrade.RAW!.sampleSize, 248);
  // Graded rows use the per-grade median.
  assert.equal(byGrade.PSA_10!.medianPence, usdToPence(1349));
  assert.equal(byGrade.PSA_10!.sampleSize, 249);
  assert.equal(byGrade.BGS_9_5!.medianPence, usdToPence(749.99));
  assert.equal(byGrade.CGC_10!.medianPence, usdToPence(800));

  // Every row carries a non-bare signal: a sample size and a source.
  for (const row of ladder) {
    assert.ok(row.sampleSize > 0);
    assert.equal(row.source, "pokemon-price-tracker");
    assert.ok(row.medianPence > 0);
  }
});

test("mapCardAggregateToComp attaches the grade ladder to raw", () => {
  const c = mapCardAggregateToComp(fixture, ctx("RAW"));
  const ladder = (c.raw as { gradeLadder?: { grade: string }[] }).gradeLadder ?? [];
  assert.ok(ladder.length >= 5);
  assert.ok(ladder.some((row) => row.grade === "PSA_10"));
});

test("buildGradeLadder returns empty array when no eBay grades present", () => {
  assert.deepEqual(buildGradeLadder({ data: [{ name: "X", ebay: {} }] }), []);
  assert.deepEqual(buildGradeLadder(null), []);
});

test("missing grade returns empty result, not an error", () => {
  const c = mapCardAggregateToComp(fixture, ctx("BGS_10"));
  assert.equal(c.sampleSize, 0);
  assert.equal(c.medianPence, 0);
  assert.equal(c.trendPct, null);
  assert.match((c.raw as { reason?: string }).reason ?? "", /BGS 10/);
});

test("malformed payload returns empty result", () => {
  const nullComp = mapCardAggregateToComp(null, ctx("RAW"));
  const malformedComp = mapCardAggregateToComp({ data: {} }, ctx("RAW"));

  assert.equal(nullComp.sampleSize, 0);
  assert.equal(malformedComp.sampleSize, 0);
  assert.match((malformedComp.raw as { reason?: string }).reason ?? "", /grade aggregate/);
});

test("PokemonPriceTrackerSource degrades when live fetch fails or times out", async () => {
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.ok(init?.signal, "live requests should carry a timeout signal");
    throw new Error("network timeout");
  }) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 5);
  const comp = await source.lookup(card, { grade: "RAW" });

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.match((comp.raw as { reason?: string }).reason ?? "", /failed|no response/);
});

test("PokemonPriceTrackerSource retries a graded lookup when the first matched response lacks the grade bucket", async () => {
  let calls = 0;
  const first = {
    data: [{ name: "Retrymon", number: "1/1", setName: "151", ebay: { salesByGrade: {} } }],
  };
  const second = {
    data: [
      {
        name: "Retrymon",
        number: "1/1",
        setName: "151",
        ebay: {
          salesByGrade: {
            psa10: {
              count: 8,
              medianPrice: 100,
              averagePrice: 102,
              minPrice: 80,
              maxPrice: 130,
              lastMarketUpdate: "2026-07-01T00:00:00.000Z",
            },
          },
        },
      },
    ],
  };
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.ok(init?.signal, "live requests should carry a timeout signal");
    calls += 1;
    return new Response(JSON.stringify(calls === 1 ? first : second), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 25);
  const comp = await source.lookup({ name: "Retrymon", number: "1/1", setName: "151" }, { grade: "PSA_10" });

  assert.equal(calls, 2);
  assert.equal(comp.sampleSize, 8);
  assert.equal(comp.medianPence, usdToPence(100));
});

test("PokemonPriceTrackerSource live requests use the low-credit limit and cap history days", async () => {
  let requestedUrlString: string | null = null;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.ok(init?.signal, "live requests should carry a timeout signal");
    requestedUrlString = String(url);
    return new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 5);
  const comp = await source.lookup(card, { grade: "RAW", windowDays: 365 });

  assert.ok(requestedUrlString);
  const requestedUrl = new URL(requestedUrlString);
  assert.equal(comp.sampleSize, 248);
  assert.equal(requestedUrl.searchParams.get("limit"), "1");
  assert.equal(requestedUrl.searchParams.get("days"), "180");
  assert.equal(requestedUrl.searchParams.get("includeEbay"), "true");
  assert.equal(requestedUrl.searchParams.get("set"), "151");
});
