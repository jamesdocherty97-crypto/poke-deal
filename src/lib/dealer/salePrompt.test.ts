import assert from "node:assert/strict";
import test from "node:test";

import { buildSalePrompt } from "./salePrompt.js";

test("buildSalePrompt asks for a total before booking", () => {
  const prompt = buildSalePrompt({
    salePricePence: 0,
    soldQuantity: 1,
    nextSaleAvailable: false,
  });

  assert.equal(prompt.title, "Enter sale total");
  assert.equal(prompt.cta, "Paste gross");
  assert.equal(prompt.tone, "info");
});

test("buildSalePrompt summarizes a profitable sale", () => {
  const prompt = buildSalePrompt({
    salePricePence: 5175,
    netPence: 4320,
    profitPence: 1320,
    soldQuantity: 1,
    nextSaleAvailable: true,
  });

  assert.equal(prompt.title, "Ready to book");
  assert.equal(prompt.cta, "Create sale");
  assert.equal(prompt.tone, "good");
  assert.match(prompt.detail, /£13\.20 profit/);
  assert.match(prompt.detail, /Save \+ next/);
});

test("buildSalePrompt warns before booking a loss", () => {
  const prompt = buildSalePrompt({
    salePricePence: 3000,
    netPence: 2200,
    profitPence: -500,
    soldQuantity: 2,
    nextSaleAvailable: false,
  });

  assert.equal(prompt.title, "Review loss");
  assert.equal(prompt.tone, "warn");
  assert.match(prompt.detail, /2 cards/);
  assert.match(prompt.detail, /-£5\.00 loss/);
});
