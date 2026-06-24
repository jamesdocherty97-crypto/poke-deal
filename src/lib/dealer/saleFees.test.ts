import test from "node:test";
import assert from "node:assert/strict";
import {
  breakEvenSalePricePence,
  buyerPaidPostagePence,
  defaultGrossSalePence,
  estimateSaleCosts,
  postedSalePostagePence,
  saleNetPence,
} from "./saleFees.js";

test("estimateSaleCosts applies UK-friendly selling presets", () => {
  assert.deepEqual(estimateSaleCosts("EBAY", 5000), { feesPence: 670, postagePence: 175 });
  assert.deepEqual(estimateSaleCosts("CARDMARKET", 5000), { feesPence: 250, postagePence: 175 });
  assert.deepEqual(estimateSaleCosts("VINTED", 5000), { feesPence: 0, postagePence: 0 });
  assert.deepEqual(estimateSaleCosts("IN_PERSON", 5000), { feesPence: 0, postagePence: 0 });
});

test("estimateSaleCosts uses tracked postage for slab sales", () => {
  assert.deepEqual(estimateSaleCosts("EBAY", 5000, { grade: "PSA_10" }), {
    feesPence: 670,
    postagePence: 499,
  });
  assert.equal(postedSalePostagePence("RAW"), 175);
  assert.equal(postedSalePostagePence("CGC_10"), 499);
});

test("defaultGrossSalePence adds buyer-paid postage for posted marketplaces", () => {
  assert.equal(buyerPaidPostagePence("EBAY", "RAW"), 175);
  assert.equal(buyerPaidPostagePence("CARDMARKET", "PSA_10"), 499);
  assert.equal(buyerPaidPostagePence("VINTED", "RAW"), 0);
  assert.equal(buyerPaidPostagePence("IN_PERSON", "PSA_10"), 0);

  assert.equal(defaultGrossSalePence("EBAY", 5000, { grade: "RAW" }), 5175);
  assert.equal(defaultGrossSalePence("EBAY", 5000, { grade: "PSA_10" }), 5499);
  assert.equal(defaultGrossSalePence("IN_PERSON", 5000, { grade: "PSA_10" }), 5000);
});

test("saleNetPence nets fees and postage from the booked sale price", () => {
  assert.equal(saleNetPence({ salePricePence: 5000, feesPence: 670, postagePence: 175 }), 4155);
});

test("breakEvenSalePricePence returns the lowest total that clears selling costs", () => {
  const price = breakEvenSalePricePence("EBAY", 1800);
  const costs = estimateSaleCosts("EBAY", price);
  const previousCosts = estimateSaleCosts("EBAY", price - 1);

  assert.equal(
    saleNetPence({ salePricePence: price, feesPence: costs.feesPence, postagePence: costs.postagePence }) >= 1800,
    true,
  );
  assert.equal(
    saleNetPence({
      salePricePence: price - 1,
      feesPence: previousCosts.feesPence,
      postagePence: previousCosts.postagePence,
    }) < 1800,
    true,
  );
});

test("breakEvenSalePricePence keeps no-fee channels simple", () => {
  assert.equal(breakEvenSalePricePence("IN_PERSON", 1800), 1800);
  assert.equal(breakEvenSalePricePence("VINTED", 1800), 1800);
});
