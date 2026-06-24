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
  assert.equal(verdict.stockActionLabel, "Add checked comp");
  assert.equal(verdict.requiresCheckedComp, true);
});

test("buildDealerCompVerdict forces manual checks when raw baselines are far apart", () => {
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

  assert.equal(verdict.tone, "danger");
  assert.equal(verdict.label, "Manual check");
  assert.equal(verdict.title, "Do not trust one number");
  assert.equal(verdict.spreadPct, 61);
  assert.equal(verdict.stockActionLabel, "Add checked comp");
  assert.equal(verdict.requiresCheckedComp, true);
});

test("buildDealerCompVerdict labels a lone catalog market fallback", () => {
  const verdict = buildDealerCompVerdict({
    headline: comp({
      source: "pokemon-tcg-market",
      medianPence: 4100,
      sampleSize: 1,
      raw: { kind: "catalog-market-baseline" },
    }),
    all: [comp({ source: "pokemon-tcg-market", medianPence: 4100, sampleSize: 1, raw: { kind: "catalog-market-baseline" } })],
    sourcesDisagree: false,
  });

  assert.equal(verdict.tone, "warn");
  assert.equal(verdict.label, "Catalog only");
  assert.equal(verdict.title, "Manual sold check");
  assert.equal(verdict.stockActionLabel, "Check solds first");
  assert.equal(verdict.requiresCheckedComp, false);
});

test("buildDealerCompVerdict distinguishes thin and aligned usable comps", () => {
  const thin = buildDealerCompVerdict({
    headline: comp({ sampleSize: 1 }),
    all: [comp({ sampleSize: 1 })],
    sourcesDisagree: false,
  });
  assert.equal(thin.title, "Guide price only");
  assert.equal(thin.stockActionLabel, "Stock with care");
  assert.equal(thin.requiresCheckedComp, false);

  const usable = buildDealerCompVerdict({
    headline: comp(),
    all: [comp(), comp({ source: "pokemon-tcg-market", medianPence: 2520, sampleSize: 1 })],
    sourcesDisagree: false,
  });
  assert.equal(usable.tone, "good");
  assert.equal(usable.label, "Usable");
  assert.equal(usable.stockActionLabel, "Stock this");
});

test("buildDealerCompVerdict warns on single-source graded comps", () => {
  const verdict = buildDealerCompVerdict({
    headline: comp({ grade: "PSA_10", medianPence: 37756, sampleSize: 293 }),
    all: [comp({ grade: "PSA_10", medianPence: 37756, sampleSize: 293 })],
    sourcesDisagree: false,
  });

  assert.equal(verdict.tone, "warn");
  assert.equal(verdict.label, "Single graded");
  assert.equal(verdict.title, "Manual check needed");
  assert.equal(verdict.stockActionLabel, "Check slab solds");
  assert.equal(verdict.requiresCheckedComp, false);
});
