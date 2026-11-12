import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DEAL_CALC_SETTINGS,
  dealCalc,
  netProceedsAtSalePrice,
  normalizeDealCalcSettings,
  postageForSalePrice,
  type DealCalcCompInput,
} from "./dealCalc.js";
import { ebayUkSellerFeesPence } from "./ebayUkFees.js";

function comp(overrides: Partial<DealCalcCompInput>): DealCalcCompInput {
  return {
    headlinePence: 10000,
    confidence: "high",
    manualCheck: false,
    gradeBucket: "RAW",
    sampleSizeOfChosen: 500,
    reasons: [],
    ...overrides,
  };
}

test("D1: high-confidence liquid raw comp produces cash and trade ceilings", () => {
  const result = dealCalc(comp({ headlinePence: 10000, confidence: "high", sampleSizeOfChosen: 500 }));

  assert.equal(result.netProceedsPence, 8190);
  assert.equal(result.maxCashOfferPence, 6800);
  assert.equal(result.maxTradeOfferPence, 7400);
  assert.equal(result.expectedProfitPence, 1390);
  assert.equal(result.route, "flip");
});

test("D2: medium confidence applies confidence haircut before quoting", () => {
  const result = dealCalc(comp({ headlinePence: 10000, confidence: "medium", sampleSizeOfChosen: 500 }));

  assert.equal(result.netProceedsPence, 8190);
  assert.equal(result.maxCashOfferPence, 5800);
  assert.equal(result.expectedProfitPence, 1162);
  assert.match(result.reasons.join(" "), /medium confidence haircut/);
});

test("D3: manual-check reconciler output refuses to auto-quote and keeps reasons", () => {
  const result = dealCalc(
    comp({
      headlinePence: 179200,
      manualCheck: true,
      reasons: ["penalty-raw-bucket-spread", "ambiguous-query"],
    }),
  );

  assert.equal(result.route, "no-quote");
  assert.equal(result.maxCashOfferPence, null);
  assert.equal(result.maxTradeOfferPence, null);
  assert.match(result.reasons.join(" "), /penalty-raw-bucket-spread/);
  assert.match(result.reasons.join(" "), /manual check required/);
});

test("D4: low-confidence cheap cards still quote with a warning reason", () => {
  const result = dealCalc(comp({ headlinePence: 8000, confidence: "low", sampleSizeOfChosen: 500 }));

  assert.equal(result.route, "flip");
  assert.equal(result.netProceedsPence, 6486);
  assert.equal(result.maxCashOfferPence, 3700);
  assert.match(result.reasons.join(" "), /low confidence/);
});

test("D5: low-confidence expensive cards refuse automatic quotes", () => {
  const result = dealCalc(comp({ headlinePence: 50000, confidence: "low", sampleSizeOfChosen: 500 }));

  assert.equal(result.route, "no-quote");
  assert.equal(result.maxCashOfferPence, null);
  assert.match(result.reasons.join(" "), /low confidence above £100/);
});

test("D6: missing headline comp refuses to quote", () => {
  const result = dealCalc(comp({ headlinePence: null }));

  assert.equal(result.route, "no-quote");
  assert.equal(result.netProceedsPence, null);
  assert.equal(result.maxCashOfferPence, null);
  assert.match(result.reasons.join(" "), /no headline comp/);
});

test("D7: thin chosen sample applies liquidity haircut and records why", () => {
  const result = dealCalc(comp({ headlinePence: 10000, confidence: "high", sampleSizeOfChosen: 11 }));

  assert.equal(result.maxCashOfferPence, 5800);
  assert.match(result.reasons.join(" "), /thin liquidity haircut/);
});

test("D8: raw chase card shows grading EV and only uses medium-or-better graded comps", () => {
  const settings = normalizeDealCalcSettings({
    grading: {
      costPence: 2500,
      gradeProbabilities: { PSA_10: 0.35, PSA_9: 0.5, PSA_8: 0.15 },
    },
  });
  const result = dealCalc(
    comp({
      headlinePence: 30000,
      confidence: "high",
      sampleSizeOfChosen: 500,
      gradedComps: [
        { grade: "PSA_10", headlinePence: 106200, confidence: "medium" },
        { grade: "PSA_9", headlinePence: 42000, confidence: "low" },
      ],
    }),
    settings,
  );

  assert.equal(result.netProceedsPence, 24950);
  assert.equal(netProceedsAtSalePrice(106200, settings), 89872);
  assert.equal(result.gradeRoute?.evPence, 28955);
  assert.equal(result.gradeRoute?.breakdown.length, 1);
  assert.equal(result.route, "flip");
});

test("D9: promoted toggle off removes the promoted fee from net proceeds", () => {
  const settings = normalizeDealCalcSettings({ fees: { ...DEFAULT_DEAL_CALC_SETTINGS.fees, promotedEnabled: false } });
  const result = dealCalc(comp({ headlinePence: 10000, confidence: "high", sampleSizeOfChosen: 500 }), settings);

  assert.equal(result.netProceedsPence, 8390);
  assert.equal(result.maxCashOfferPence, 6900);
});

test("D10: sub-£20 postage tier and 50p quote rounding are used", () => {
  const result = dealCalc(comp({ headlinePence: 1500, confidence: "high", sampleSizeOfChosen: 500 }));

  assert.equal(result.netProceedsPence, 1063);
  assert.equal(result.maxCashOfferPence, 850);
  assert.equal(result.maxTradeOfferPence, 900);
});

function legacyFlatNet(salePricePence: number): number {
  const pct = DEFAULT_DEAL_CALC_SETTINGS.fees.ebayFvfPct + DEFAULT_DEAL_CALC_SETTINGS.fees.promotedPct;
  return Math.round(salePricePence * (1 - pct / 100))
    - DEFAULT_DEAL_CALC_SETTINGS.fees.ebayFixedPence
    - postageForSalePrice(salePricePence)
    - DEFAULT_DEAL_CALC_SETTINGS.fees.materialsPence;
}

test("T6 default settings keep today's net proceeds", () => {
  for (const price of [500, 1999, 5000, 25000]) {
    assert.equal(netProceedsAtSalePrice(price), legacyFlatNet(price));
    assert.equal(netProceedsAtSalePrice(price, DEFAULT_DEAL_CALC_SETTINGS), legacyFlatNet(price));
  }
});

test("T6 PRIVATE_UK removes only the final value percent and fixed fee", () => {
  const settings = normalizeDealCalcSettings({ fees: { sellerProfile: "PRIVATE_UK" } });
  for (const price of [500, 1999, 5000, 25000]) {
    const promotedOnly = Math.round(price * (1 - DEFAULT_DEAL_CALC_SETTINGS.fees.promotedPct / 100))
      - postageForSalePrice(price, settings)
      - settings.fees.materialsPence;
    assert.equal(netProceedsAtSalePrice(price, settings), promotedOnly);
    assert.equal(settings.fees.postageTiers[0]?.postagePence, DEFAULT_DEAL_CALC_SETTINGS.fees.postageTiers[0]?.postagePence);
    assert.equal(settings.fees.materialsPence, DEFAULT_DEAL_CALC_SETTINGS.fees.materialsPence);
    assert.equal(settings.fees.promotedPct, DEFAULT_DEAL_CALC_SETTINGS.fees.promotedPct);
    assert.equal(settings.fees.promotedEnabled, true);
  }
  const editedLegacyFields = normalizeDealCalcSettings({
    fees: { sellerProfile: "PRIVATE_UK", ebayFvfPct: 50, ebayFixedPence: 900 },
  });
  assert.equal(netProceedsAtSalePrice(5000, editedLegacyFields), netProceedsAtSalePrice(5000, settings));
});

test("T6 BUSINESS_UK replaces only the final value percent and fixed fee", () => {
  const settings = normalizeDealCalcSettings({ fees: { sellerProfile: "BUSINESS_UK", vatOnFees: true } });
  const price = 10000;
  const sellerFees = ebayUkSellerFeesPence({ profile: "BUSINESS_UK", orderTotalPence: price, vatOnFees: true });
  const expected = Math.round(price * (1 - settings.fees.promotedPct / 100))
    - sellerFees
    - postageForSalePrice(price, settings)
    - settings.fees.materialsPence;
  assert.equal(sellerFees, 1398);
  assert.equal(netProceedsAtSalePrice(price, settings), expected);
  const withoutVat = normalizeDealCalcSettings({ fees: { sellerProfile: "BUSINESS_UK", vatOnFees: false } });
  assert.equal(
    netProceedsAtSalePrice(price, withoutVat),
    Math.round(price * (1 - withoutVat.fees.promotedPct / 100))
      - ebayUkSellerFeesPence({ profile: "BUSINESS_UK", orderTotalPence: price, vatOnFees: false })
      - postageForSalePrice(price, withoutVat)
      - withoutVat.fees.materialsPence,
  );
});

test("T6 missing or unknown seller profiles stay on the legacy flat default", () => {
  assert.equal(normalizeDealCalcSettings({}).fees.sellerProfile, "LEGACY_FLAT");
  assert.equal(normalizeDealCalcSettings({}).fees.vatOnFees, true);
  assert.equal(normalizeDealCalcSettings({ fees: { sellerProfile: "nonsense" } }).fees.sellerProfile, "LEGACY_FLAT");
  assert.equal(normalizeDealCalcSettings({ fees: { sellerProfile: "nonsense" } }).fees.vatOnFees, true);
  assert.equal(normalizeDealCalcSettings({ fees: { sellerProfile: "nonsense" } }).fees.ebayFvfPct, 12.8);
  const business = normalizeDealCalcSettings({ fees: { sellerProfile: "BUSINESS_UK", vatOnFees: false } });
  assert.equal(business.fees.sellerProfile, "BUSINESS_UK");
  assert.equal(business.fees.vatOnFees, false);
});
