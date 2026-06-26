import test from "node:test";
import assert from "node:assert/strict";
import {
  breakEvenSalePricePence,
  buyerPaidPostagePence,
  defaultGrossSalePence,
  discountedItemSubtotalPence,
  estimateSaleCosts,
  grossSalePriceForNetPence,
  postedSalePostagePence,
  rescaleGrossSaleForQuantity,
  saleItemSubtotalPence,
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

test("saleItemSubtotalPence removes buyer-paid postage from posted marketplace gross", () => {
  assert.equal(saleItemSubtotalPence("EBAY", 5175, { grade: "RAW" }), 5000);
  assert.equal(saleItemSubtotalPence("CARDMARKET", 5499, { grade: "PSA_10" }), 5000);
  assert.equal(saleItemSubtotalPence("IN_PERSON", 5000, { grade: "PSA_10" }), 5000);
  assert.equal(saleItemSubtotalPence("EBAY", 100, { grade: "RAW" }), 0);
});

test("rescaleGrossSaleForQuantity preserves per-card item price and channel postage", () => {
  assert.equal(rescaleGrossSaleForQuantity("EBAY", 5175, 1, 3, { grade: "RAW" }), 15175);
  assert.equal(rescaleGrossSaleForQuantity("CARDMARKET", 5499, 1, 2, { grade: "PSA_10" }), 10499);
  assert.equal(rescaleGrossSaleForQuantity("IN_PERSON", 5000, 1, 3, { grade: "RAW" }), 15000);
});

test("discountedItemSubtotalPence handles accepted-offer shortcuts", () => {
  assert.equal(discountedItemSubtotalPence(5000, 100), 4900);
  assert.equal(discountedItemSubtotalPence(5000, 500, 2), 9000);
  assert.equal(discountedItemSubtotalPence(300, 500), 0);
});

test("saleNetPence nets fees and postage from the booked sale price", () => {
  assert.equal(saleNetPence({ salePricePence: 5000, feesPence: 670, postagePence: 175 }), 4155);
});

test("grossSalePriceForNetPence finds the gross total needed for a target payout", () => {
  const gross = grossSalePriceForNetPence("EBAY", 4000, { grade: "RAW" });
  const costs = estimateSaleCosts("EBAY", gross, { grade: "RAW" });
  const previousCosts = estimateSaleCosts("EBAY", gross - 1, { grade: "RAW" });

  assert.equal(
    saleNetPence({ salePricePence: gross, feesPence: costs.feesPence, postagePence: costs.postagePence }) >= 4000,
    true,
  );
  assert.equal(
    saleNetPence({
      salePricePence: gross - 1,
      feesPence: previousCosts.feesPence,
      postagePence: previousCosts.postagePence,
    }) < 4000,
    true,
  );
});

test("grossSalePriceForNetPence keeps no-fee channels as the pasted net", () => {
  assert.equal(grossSalePriceForNetPence("IN_PERSON", 4200), 4200);
  assert.equal(grossSalePriceForNetPence("VINTED", 4200), 4200);
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
