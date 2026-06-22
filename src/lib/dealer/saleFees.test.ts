import test from "node:test";
import assert from "node:assert/strict";
import { estimateSaleCosts, saleNetPence } from "./saleFees.js";

test("estimateSaleCosts applies UK-friendly selling presets", () => {
  assert.deepEqual(estimateSaleCosts("EBAY", 5000), { feesPence: 670, postagePence: 120 });
  assert.deepEqual(estimateSaleCosts("CARDMARKET", 5000), { feesPence: 250, postagePence: 120 });
  assert.deepEqual(estimateSaleCosts("VINTED", 5000), { feesPence: 0, postagePence: 0 });
  assert.deepEqual(estimateSaleCosts("IN_PERSON", 5000), { feesPence: 0, postagePence: 0 });
});

test("saleNetPence nets fees and postage from the booked sale price", () => {
  assert.equal(saleNetPence({ salePricePence: 5000, feesPence: 670, postagePence: 120 }), 4210);
});
