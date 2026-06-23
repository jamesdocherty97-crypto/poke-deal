import assert from "node:assert/strict";
import test from "node:test";

import { buildDealerCompVerdict, type DealerCompInput } from "./compVerdict.js";

function comp(overrides: Partial<DealerCompInput["headline"]> = {}): DealerCompInput["headline"] {
  return {
    source: "pokemon-price-tracker",
    medianPence: 2500,
    sampleSize: 12,
    ...overrides,
  };
}

test("buildDealerCompVerdict marks missing data as manual stock", () => {
  const verdict = buildDealerCompVerdict({
    headline: comp({ medianPence: 0, sampleSize: 0 }),
    all: [comp({ medianPence: 0, sampleSize: 0 })],
    sourcesDisagree: false,
  });

  assert.equal(verdict.tone, "danger");
  assert.equal(verdict.label, "No comp");
  assert.equal(verdict.title, "Stock manually");
});

test("buildDealerCompVerdict treats disagreeing raw baselines as a cautious buy ceiling", () => {
  const verdict = buildDealerCompVerdict({
    headline: comp({
      source: "pokemon-tcg-market",
      medianPence: 4100,
      sampleSize: 1,
      raw: { kind: "catalog-market-baseline" },
    }),
    all: [
      comp({ source: "pokemon-tcg-market", medianPence: 4100, sampleSize: 1, raw: { kind: "catalog-market-baseline" } }),
      comp({ source: "pokemon-price-tracker", medianPence: 6600, sampleSize: 75, raw: { chosenPriceSource: "smartMarketPrice" } }),
    ],
    sourcesDisagree: true,
  });

  assert.equal(verdict.tone, "warn");
  assert.equal(verdict.label, "Cross-check");
  assert.equal(verdict.title, "Cautious buy ceiling");
  assert.equal(verdict.spreadPct, 61);
});

test("buildDealerCompVerdict distinguishes thin and aligned usable comps", () => {
  const thin = buildDealerCompVerdict({
    headline: comp({ sampleSize: 1 }),
    all: [comp({ sampleSize: 1 })],
    sourcesDisagree: false,
  });
  assert.equal(thin.title, "Guide price only");

  const usable = buildDealerCompVerdict({
    headline: comp(),
    all: [comp(), comp({ source: "pokemon-tcg-market", medianPence: 2520, sampleSize: 1 })],
    sourcesDisagree: false,
  });
  assert.equal(usable.tone, "good");
  assert.equal(usable.label, "Usable");
});
