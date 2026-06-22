import assert from "node:assert/strict";
import test from "node:test";

import { buildListingDraftDefaults, buildListingTitle, defaultManualListPricePence } from "./listingDraft.js";

test("buildListingTitle includes number and slab grade, but keeps raw titles tidy", () => {
  assert.equal(buildListingTitle({ name: "Gengar", number: "TG06/TG30" }, "RAW"), "Gengar TG06/TG30");
  assert.equal(buildListingTitle({ name: "Gengar", number: "TG06/TG30" }, "PSA_10"), "Gengar TG06/TG30 PSA 10");
  assert.equal(buildListingTitle({ name: "Bulk Pikachu" }, "RAW"), "Bulk Pikachu");
});

test("defaultManualListPricePence protects a practical gross margin for manually stocked cards", () => {
  assert.equal(defaultManualListPricePence(1000), 1350);
  assert.equal(defaultManualListPricePence(999), 1349);
  assert.equal(defaultManualListPricePence(1000, 0.5), 1500);
  assert.equal(defaultManualListPricePence(0), 0);
});

test("buildListingDraftDefaults produces title and price from stock context", () => {
  assert.deepEqual(
    buildListingDraftDefaults({
      card: { name: "Greninja ex", number: "214/167" },
      grade: "RAW",
      costBasis: 12000,
    }),
    {
      title: "Greninja ex 214/167",
      listPricePence: 16200,
    },
  );
});
