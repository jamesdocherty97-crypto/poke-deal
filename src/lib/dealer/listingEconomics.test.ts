import assert from "node:assert/strict";
import test from "node:test";

import { buildListingEconomics } from "./listingEconomics.js";
import { estimateSaleCosts } from "./saleFees.js";

test("listing economics includes buyer-paid eBay postage and sale costs", () => {
  const economics = buildListingEconomics({
    channel: "EBAY",
    grade: "RAW",
    itemPricePence: 5000,
    costBasisPence: 3000,
  });

  assert.equal(economics.grossPence, 5175);
  assert.equal(economics.feesPence, 692);
  assert.equal(economics.postagePence, 175);
  assert.equal(economics.netPence, 4308);
  assert.equal(economics.profitPence, 1308);
  assert.equal(economics.roiPct, 43.6);
  assert.equal(economics.marginPct, 25.3);
});

test("listing economics treats in-person sales as cash price with no platform costs", () => {
  const economics = buildListingEconomics({
    channel: "IN_PERSON",
    grade: "PSA_10",
    itemPricePence: 5000,
    costBasisPence: 3000,
  });

  assert.equal(economics.grossPence, 5000);
  assert.equal(economics.feesPence, 0);
  assert.equal(economics.postagePence, 0);
  assert.equal(economics.netPence, 5000);
  assert.equal(economics.profitPence, 2000);
  assert.equal(economics.roiPct, 66.7);
  assert.equal(economics.marginPct, 40);
});

test("listing economics passes a private eBay profile through and shows what buyers see", () => {
  const economics = buildListingEconomics({
    channel: "EBAY",
    grade: "RAW",
    itemPricePence: 500,
    costBasisPence: 200,
    feeProfile: "PRIVATE_UK",
  });

  assert.equal(economics.grossPence, 675);
  assert.equal(economics.feesPence, 0);
  assert.equal(economics.postagePence, 175);
  assert.equal(economics.netPence, 500);
  assert.equal(economics.feeProfile, "PRIVATE_UK");
  assert.equal(economics.buyerSeesPence, 545);
});

test("listing economics uses business fees and leaves the buyer-visible price off", () => {
  const withVat = buildListingEconomics({
    channel: "EBAY",
    grade: "RAW",
    itemPricePence: 500,
    costBasisPence: 200,
    feeProfile: "BUSINESS_UK",
  });
  const withoutVat = buildListingEconomics({
    channel: "EBAY",
    grade: "RAW",
    itemPricePence: 500,
    costBasisPence: 200,
    feeProfile: "BUSINESS_UK",
    vatOnFees: false,
  });

  assert.equal(withVat.feesPence, 127);
  assert.equal(withVat.feeProfile, "BUSINESS_UK");
  assert.equal(withVat.buyerSeesPence, undefined);
  assert.equal(withoutVat.feesPence, 106);
  assert.equal(withVat.postagePence, 175);
});

test("listing economics does not show a buyer-visible price off eBay", () => {
  const economics = buildListingEconomics({
    channel: "CARDMARKET",
    grade: "RAW",
    itemPricePence: 500,
    costBasisPence: 200,
    feeProfile: "PRIVATE_UK",
  });

  assert.equal(economics.feesPence, estimateSaleCosts("CARDMARKET", 675).feesPence);
  assert.equal(economics.feeProfile, "PRIVATE_UK");
  assert.equal(economics.buyerSeesPence, undefined);
});
