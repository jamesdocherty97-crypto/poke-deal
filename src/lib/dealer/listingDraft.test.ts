import assert from "node:assert/strict";
import test from "node:test";

import { buildListingDraftDefaults, buildListingTitle, chooseDraftListPrice, defaultManualListPricePence, draftListPriceHint } from "./listingDraft.js";

test("buildListingTitle creates descriptive marketplace-ready defaults", () => {
  assert.equal(
    buildListingTitle({ name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06/TG30", language: "EN" }, "RAW"),
    "Pokemon TCG Gengar Lost Origin Trainer Gallery TG06/TG30 Raw English",
  );
  assert.equal(
    buildListingTitle({ name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06/TG30" }, "PSA_10"),
    "Pokemon TCG Gengar Lost Origin Trainer Gallery TG06/TG30 PSA 10 GEM MINT English",
  );
  assert.equal(buildListingTitle({ name: "Bulk Pikachu" }, "RAW"), "Pokemon TCG Bulk Pikachu Raw English");
});

test("defaultManualListPricePence protects a practical gross margin for manually stocked cards", () => {
  assert.equal(defaultManualListPricePence(1000), 1350);
  assert.equal(defaultManualListPricePence(999), 1349);
  assert.equal(defaultManualListPricePence(1000, 0.5), 1500);
  assert.equal(defaultManualListPricePence(0), 0);
});

test("chooseDraftListPrice uses the price check when that card has one", () => {
  assert.deepEqual(chooseDraftListPrice({ costBasisPence: 2500, priceCheckPence: 4200 }), {
    listPricePence: 4200,
    source: "price-check",
  });
  assert.equal(draftListPriceHint("price-check"), "The suggestion is prefilled. Edit it freely before saving.");
});

test("chooseDraftListPrice keeps cost plus 35 percent and says so when no price check exists", () => {
  assert.deepEqual(chooseDraftListPrice({ costBasisPence: 2500, priceCheckPence: null }), {
    listPricePence: 3375,
    source: "cost-plus-margin",
  });
  assert.equal(
    draftListPriceHint("cost-plus-margin"),
    "Starting price is what you paid plus 35%. No price check yet.",
  );
});

test("chooseDraftListPrice does not invent a price from an empty or invalid check", () => {
  for (const priceCheckPence of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    const chosen = chooseDraftListPrice({ costBasisPence: 2500, priceCheckPence });
    assert.equal(chosen.source, "cost-plus-margin");
    assert.equal(chosen.listPricePence, 3375);
  }
});

test("buildListingDraftDefaults produces title and price from stock context", () => {
  assert.deepEqual(
    buildListingDraftDefaults({
      card: { name: "Greninja ex", number: "214/167" },
      grade: "RAW",
      costBasis: 12000,
    }),
    {
      title: "Pokemon TCG Greninja ex 214/167 Raw English",
      listPricePence: 16200,
    },
  );
});

test("stock condition and printing survive draft creation", () => {
  const draft = buildListingDraftDefaults({
    card: { name: "Pikachu", number: "60/64", edition: "FIRST_EDITION", finish: "NORMAL" },
    grade: "RAW",
    condition: "DMG",
    costBasis: 200,
  });
  assert.match(draft.title, /1st Edition Non-Holo DMG Raw/);
  assert.doesNotMatch(draft.title, /Near Mint/);
});
