import test from "node:test";
import assert from "node:assert/strict";
import {
  BUSINESS_FINAL_VALUE_FEE_PCT,
  buyerProtectionFeePence,
  buyerSeesPence,
  EBAY_UK_FEE_SOURCE_URLS,
  ebayUkSellerFeesPence,
  feeProfileLabel,
  PER_ORDER_FEE_ABOVE_1000_PENCE,
  PER_ORDER_FEE_UP_TO_1000_PENCE,
  privateItemPriceForBuyerVisiblePence,
  RATES_CHECKED,
  REGULATORY_OPERATING_FEE_PCT,
  VAT_ON_FEES_PCT,
} from "./ebayUkFees.js";
import {
  acceptedOfferItemSubtotalPence,
  breakEvenSalePricePence,
  buyerPaidPostagePence,
  defaultGrossSalePence,
  discountedItemSubtotalPence,
  estimateSaleCosts,
  grossSalePriceForProfitPence,
  grossSalePriceForNetPence,
  postedSalePostagePence,
  rescaleGrossSaleForQuantity,
  salePriceBreakdown,
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

test("salePriceBreakdown shows item subtotal, postage and per-card price", () => {
  assert.deepEqual(salePriceBreakdown("EBAY", 15175, 3, { grade: "RAW" }), {
    grossPence: 15175,
    itemSubtotalPence: 15000,
    postagePaidPence: 175,
    unitItemPence: 5000,
    quantity: 3,
  });
  assert.deepEqual(salePriceBreakdown("IN_PERSON", 15000, 3, { grade: "RAW" }), {
    grossPence: 15000,
    itemSubtotalPence: 15000,
    postagePaidPence: 0,
    unitItemPence: 5000,
    quantity: 3,
  });
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

test("acceptedOfferItemSubtotalPence handles percentage offers", () => {
  assert.equal(acceptedOfferItemSubtotalPence(5000, 0.9), 4500);
  assert.equal(acceptedOfferItemSubtotalPence(999, 0.85, 2), 1698);
  assert.equal(acceptedOfferItemSubtotalPence(5000, 1.2), 5000);
  assert.equal(acceptedOfferItemSubtotalPence(5000, -1), 0);
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

test("grossSalePriceForProfitPence targets profit after selling costs", () => {
  const gross = grossSalePriceForProfitPence("EBAY", 1800, 500, { grade: "RAW" });
  const costs = estimateSaleCosts("EBAY", gross, { grade: "RAW" });
  const previousCosts = estimateSaleCosts("EBAY", gross - 1, { grade: "RAW" });

  assert.equal(
    saleNetPence({ salePricePence: gross, feesPence: costs.feesPence, postagePence: costs.postagePence }) >= 2300,
    true,
  );
  assert.equal(
    saleNetPence({
      salePricePence: gross - 1,
      feesPence: previousCosts.feesPence,
      postagePence: previousCosts.postagePence,
    }) < 2300,
    true,
  );
});

test("grossSalePriceForProfitPence keeps no-fee profit targets simple", () => {
  assert.equal(grossSalePriceForProfitPence("IN_PERSON", 1800, 500), 2300);
  assert.equal(grossSalePriceForProfitPence("VINTED", 1800, 500), 2300);
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

test("T1 LEGACY_FLAT matches the previous 12.8% plus 30p formula", () => {
  for (const total of [0, 1, 99, 675, 1000, 1001, 2500, 10000, 123456]) {
    const legacy = Math.round(total * 0.128) + (total > 0 ? 30 : 0);
    assert.equal(ebayUkSellerFeesPence({ profile: "LEGACY_FLAT", orderTotalPence: total }), legacy);
    assert.equal(estimateSaleCosts("EBAY", total).feesPence, legacy);
    assert.equal(estimateSaleCosts("EBAY", total, { feeProfile: "LEGACY_FLAT", vatOnFees: false }).feesPence, legacy);
  }
});

test("T2 PRIVATE_UK seller fees are zero and postage is unchanged", () => {
  for (const total of [0, 1, 99, 675, 1000, 1001, 2500, 10000, 123456]) {
    assert.equal(ebayUkSellerFeesPence({ profile: "PRIVATE_UK", orderTotalPence: total }), 0);
    assert.deepEqual(estimateSaleCosts("EBAY", total, { feeProfile: "PRIVATE_UK", grade: "RAW" }), {
      feesPence: 0,
      postagePence: 175,
    });
    assert.deepEqual(estimateSaleCosts("EBAY", total, { feeProfile: "PRIVATE_UK", grade: "PSA_10" }), {
      feesPence: 0,
      postagePence: 499,
    });
  }
  assert.equal(estimateSaleCosts("CARDMARKET", 5000, { feeProfile: "PRIVATE_UK" }).feesPence, 250);
});

test("T3 BUSINESS_UK fees match the published pence with and without VAT", () => {
  const withVat = [675, 1000, 1001, 1175, 2675, 10000];
  const withVatFees = [127, 171, 183, 207, 409, 1398];
  const withoutVatFees = [106, 143, 153, 172, 341, 1165];
  withVat.forEach((total, index) => {
    assert.equal(ebayUkSellerFeesPence({ profile: "BUSINESS_UK", orderTotalPence: total, vatOnFees: true }), withVatFees[index]);
    assert.equal(ebayUkSellerFeesPence({ profile: "BUSINESS_UK", orderTotalPence: total }), withVatFees[index]);
    assert.equal(
      estimateSaleCosts("EBAY", total, { feeProfile: "BUSINESS_UK", vatOnFees: true }).feesPence,
      withVatFees[index],
    );
    assert.equal(ebayUkSellerFeesPence({ profile: "BUSINESS_UK", orderTotalPence: total, vatOnFees: false }), withoutVatFees[index]);
    assert.equal(
      estimateSaleCosts("EBAY", total, { feeProfile: "BUSINESS_UK", vatOnFees: false }).feesPence,
      withoutVatFees[index],
    );
  });
  assert.equal(estimateSaleCosts("EBAY", 675, { feeProfile: "BUSINESS_UK", grade: "RAW" }).postagePence, 175);
  assert.equal(estimateSaleCosts("EBAY", 675, { feeProfile: "BUSINESS_UK", grade: "PSA_10" }).postagePence, 499);
});

test("T4 the business per-order fee is 30p at £10 and 40p above £10", () => {
  const withVat = (total: number, perOrder: number) => Math.round((total * 1125 + perOrder * 10000) * 12 / 100000);
  assert.equal(ebayUkSellerFeesPence({ profile: "BUSINESS_UK", orderTotalPence: 1000 }), withVat(1000, 30));
  assert.notEqual(ebayUkSellerFeesPence({ profile: "BUSINESS_UK", orderTotalPence: 1000 }), withVat(1000, 40));
  assert.equal(ebayUkSellerFeesPence({ profile: "BUSINESS_UK", orderTotalPence: 1001 }), withVat(1001, 40));
  assert.notEqual(ebayUkSellerFeesPence({ profile: "BUSINESS_UK", orderTotalPence: 1001 }), withVat(1001, 30));
  assert.equal(PER_ORDER_FEE_UP_TO_1000_PENCE, 30);
  assert.equal(PER_ORDER_FEE_ABOVE_1000_PENCE, 40);
});

test("T5 buyer protection fees and the private list-price inverse", () => {
  const cases: Array<[number, number]> = [
    [100, 17],
    [500, 45],
    [1000, 80],
    [2000, 150],
    [5000, 270],
    [30000, 1270],
  ];
  for (const [item, fee] of cases) {
    assert.equal(buyerProtectionFeePence(item), fee);
    assert.equal(buyerSeesPence(item), item + fee);
  }
  assert.equal(buyerProtectionFeePence(0), 0);
  assert.equal(buyerProtectionFeePence(-50), 0);
  assert.equal(buyerSeesPence(0), 0);
  for (let price = 1; price <= 60000; price += 1) {
    assert.equal(privateItemPriceForBuyerVisiblePence(price + buyerProtectionFeePence(price)), price);
  }
  assert.equal(privateItemPriceForBuyerVisiblePence(0), 0);
});

test("T7 published rate constants and the date they were checked", () => {
  assert.equal(BUSINESS_FINAL_VALUE_FEE_PCT, 10.9);
  assert.equal(REGULATORY_OPERATING_FEE_PCT, 0.35);
  assert.equal(PER_ORDER_FEE_UP_TO_1000_PENCE, 30);
  assert.equal(PER_ORDER_FEE_ABOVE_1000_PENCE, 40);
  assert.equal(VAT_ON_FEES_PCT, 20);
  assert.equal(RATES_CHECKED, "2026-11-12");
  assert.deepEqual(EBAY_UK_FEE_SOURCE_URLS, [
    "https://www.ebay.co.uk/help/selling/fees-credits-invoices/selling-fees-private-sellers?id=4822",
    "https://www.ebay.co.uk/help/selling/fees-credits-invoices/selling-fees?id=4809",
    "https://www.ebay.co.uk/help/buying/paying-items/buyer-protection?id=5595",
  ]);
  assert.equal(feeProfileLabel("LEGACY_FLAT"), "Old flat 12.8% + 30p");
  assert.equal(feeProfileLabel("PRIVATE_UK"), "UK private seller");
  assert.equal(feeProfileLabel("BUSINESS_UK"), "UK business seller");
});
