import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toGbpPence,
  formatGbp,
  STATIC_RATES,
  getRates,
  parseFxPayload,
  type FxRateDb,
} from "./currency.js";

test("GBP is identity (to pence)", () => {
  assert.equal(toGbpPence(12.5, "GBP"), 1250);
});

test("EUR converts to GBP pence", () => {
  // £1 = €1.17 → €31 = £26.50
  assert.equal(toGbpPence(31, "EUR"), 2650);
});

test("USD converts to GBP pence", () => {
  // £1 = $1.27 → $35 = £27.56
  assert.equal(toGbpPence(35, "USD"), 2756);
});

test("conversion rounds half-up after converting to GBP", () => {
  const rates = { asOf: "2026-07-03", perGbp: { GBP: 1, EUR: 1, USD: 1, JPY: 1 } } as typeof STATIC_RATES;
  assert.equal(toGbpPence(1.005, "USD", rates), 101);
});

test("JPY converts to GBP pence", () => {
  assert.equal(toGbpPence(192, "JPY"), 100);
});

test("unknown/zero rate throws (fail loud)", () => {
  const broken = { asOf: "x", perGbp: { GBP: 1, EUR: 0, USD: 1.27, JPY: 192 } } as typeof STATIC_RATES;
  assert.throws(() => toGbpPence(10, "EUR", broken));
});

test("formatGbp", () => {
  assert.equal(formatGbp(1250), "£12.50");
  assert.equal(formatGbp(0), "£0.00");
  assert.equal(formatGbp(-500), "-£5.00");
});

test("getRates returns today's cached rates without fetching", async () => {
  const db = fakeFxDb([
    row("GBP", 1, "2026-07-03"),
    row("USD", 1.31, "2026-07-03"),
    row("EUR", 1.18, "2026-07-03"),
    row("JPY", 194, "2026-07-03"),
  ]);
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    throw new Error("should not fetch");
  }) as typeof fetch;

  const rates = await getRates({
    db: db.client,
    now: new Date("2026-07-03T14:00:00.000Z"),
    apiKey: "key",
    fetchImpl,
  });

  assert.equal(fetchCalls, 0);
  assert.equal(rates.source, "cached");
  assert.equal(rates.perGbp.USD, 1.31);
});

test("getRates fetches live rates once per day and writes the cache", async () => {
  const db = fakeFxDb();
  const fetchImpl = (async (url: string | URL | Request) => {
    const text = String(url);
    assert.match(text, /access_key=key/);
    assert.match(text, /base=GBP/);
    return Response.json({ base: "GBP", date: "2026-07-03", rates: { USD: 1.3, EUR: 1.19, JPY: 195 } });
  }) as typeof fetch;

  const rates = await getRates({
    db: db.client,
    now: new Date("2026-07-03T09:00:00.000Z"),
    apiKey: "key",
    endpoint: "https://api.example.test/latest",
    fetchImpl,
  });

  assert.equal(rates.source, "live");
  assert.equal(rates.perGbp.USD, 1.3);
  assert.equal(db.rows.length, 4);
  assert.equal(db.rows.find((item) => item.quote === "EUR")?.perGbp, 1.19);
});

test("getRates falls back to cached rates up to seven days old", async () => {
  const db = fakeFxDb([
    row("GBP", 1, "2026-06-28"),
    row("USD", 1.26, "2026-06-28"),
    row("EUR", 1.16, "2026-06-28"),
    row("JPY", 190, "2026-06-28"),
  ]);

  const rates = await getRates({
    db: db.client,
    now: new Date("2026-07-03T09:00:00.000Z"),
    apiKey: "",
  });

  assert.equal(rates.source, "cached");
  assert.equal(rates.ageDays, 5);
  assert.equal(rates.perGbp.USD, 1.26);
});

test("getRates uses visible static fallback when cache is too old or absent", async () => {
  const db = fakeFxDb([
    row("GBP", 1, "2026-06-20"),
    row("USD", 1.2, "2026-06-20"),
    row("EUR", 1.1, "2026-06-20"),
    row("JPY", 180, "2026-06-20"),
  ]);

  const rates = await getRates({
    db: db.client,
    now: new Date("2026-07-03T09:00:00.000Z"),
    apiKey: "",
  });

  assert.equal(rates.source, "static");
  assert.equal(rates.note, "static FX");
  assert.equal(rates.perGbp.USD, STATIC_RATES.perGbp.USD);
});

test("parseFxPayload accepts rates and data payload shapes", () => {
  const ratesPayload = parseFxPayload(
    { base: "GBP", date: "2026-07-03", rates: { USD: 1.3, EUR: 1.19, JPY: 195 } },
    "test",
    new Date("2026-07-03T09:00:00.000Z"),
  );
  const dataPayload = parseFxPayload(
    { base_currency: "GBP", data: { USD: 1.31, EUR: 1.2, JPY: 196 } },
    "freecurrencyapi",
    new Date("2026-07-03T09:00:00.000Z"),
  );

  assert.equal(ratesPayload.perGbp.EUR, 1.19);
  assert.equal(dataPayload.perGbp.USD, 1.31);
  assert.equal(dataPayload.provider, "freecurrencyapi");
});

type FxRateTestRow = {
  quote: string;
  perGbp: number;
  asOf: Date;
  provider: string;
  fetchedAt: Date;
};

function fakeFxDb(seed: FxRateTestRow[] = []) {
  const rows = [...seed];
  const client: FxRateDb = {
    fxRate: {
      async findMany() {
        return [...rows].sort((a, b) => b.asOf.getTime() - a.asOf.getTime());
      },
      async createMany({ data }) {
        let count = 0;
        for (const item of data) {
          if (rows.some((row) => row.quote === item.quote && row.asOf.getTime() === new Date(item.asOf).getTime())) {
            continue;
          }
          rows.push({
            quote: item.quote,
            perGbp: item.perGbp,
            asOf: new Date(item.asOf),
            provider: item.provider,
            fetchedAt: new Date(item.fetchedAt ?? Date.now()),
          });
          count += 1;
        }
        return { count };
      },
    },
  };
  return { client, rows };
}

function row(quote: FxRateTestRow["quote"], perGbp: number, day: string): FxRateTestRow {
  return {
    quote,
    perGbp,
    asOf: new Date(`${day}T00:00:00.000Z`),
    provider: "test-provider",
    fetchedAt: new Date(`${day}T07:00:00.000Z`),
  };
}
