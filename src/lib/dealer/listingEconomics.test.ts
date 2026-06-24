import assert from "node:assert/strict";
import test from "node:test";

import { buildListingEconomics } from "./listingEconomics.js";

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
