import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCardIntakePayload,
  DEFAULT_INTAKE_PREFERENCES,
  intakeDraftListPricePence,
  nextIntakeFormAfterStock,
  parseIntakePreferences,
  parseIntakeQuantity,
  sameCardIntakeIdentity,
  serializeIntakePreferences,
} from "./intakeSession.js";

test("buildCardIntakePayload omits blank optional identity fields", () => {
  assert.deepEqual(
    buildCardIntakePayload({
      name: "  Gengar  ",
      setName: "   ",
      number: "",
      tcgApiId: null,
      tcgDexId: "  ",
      language: "EN",
      game: "POKEMON",
    }),
    { name: "Gengar", language: "EN", game: "POKEMON" },
  );
});

test("buildCardIntakePayload keeps canonical printing identity", () => {
  assert.deepEqual(
    buildCardIntakePayload({
      name: " Pikachu ",
      setName: "  Base Set  ",
      number: " 58/102 ",
      tcgApiId: " base1-58 ",
      edition: "FIRST_EDITION",
      finish: "NORMAL",
      language: "EN",
    }),
    {
      name: "Pikachu",
      setName: "Base Set",
      number: "58/102",
      tcgApiId: "base1-58",
      edition: "FIRST_EDITION",
      finish: "NORMAL",
      language: "EN",
    },
  );
});

test("eBay intake leaves sub-minimum draft prices for review instead of rejecting stock", () => {
  assert.equal(intakeDraftListPricePence("EBAY", true, 98), null);
  assert.equal(intakeDraftListPricePence("EBAY", true, 99), 99);
  assert.equal(intakeDraftListPricePence("CARDMARKET", true, 50), 50);
  assert.equal(intakeDraftListPricePence("EBAY", false, 500), null);
});

test("scan photos only match the confirmed card printing", () => {
  const scan = { name: "Gengar", setName: "Lost Origin", number: "TG06/TG30" };
  assert.equal(sameCardIntakeIdentity(scan, { name: "gengar", setName: "Trainer Gallery", number: "TG06-TG30" }), true);
  assert.equal(sameCardIntakeIdentity(scan, { name: "Gengar", setName: "Lost Origin", number: "TG07/TG30" }), false);
  assert.equal(sameCardIntakeIdentity(scan, { name: "Pikachu", setName: "Lost Origin", number: "TG06/TG30" }), false);
  assert.equal(
    sameCardIntakeIdentity(
      { name: "Pikachu", setName: "Base Set", number: "" },
      { name: "Pikachu", setName: "Jungle", number: "" },
    ),
    false,
  );
});

test("parseIntakeQuantity accepts positive whole quantities only", () => {
  assert.equal(parseIntakeQuantity("1"), 1);
  assert.equal(parseIntakeQuantity("3"), 3);
  assert.equal(parseIntakeQuantity("0"), null);
  assert.equal(parseIntakeQuantity("1.5"), null);
  assert.equal(parseIntakeQuantity("abc"), null);
});

test("nextIntakeFormAfterStock clears card-specific fields for a repeated buying session", () => {
  const current = {
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    number: "TG06/TG30",
    cost: "30.00",
    quantity: "2",
  };

  assert.deepEqual(nextIntakeFormAfterStock(current, true), {
    name: "",
    setName: "Lost Origin Trainer Gallery",
    number: "",
    cost: "",
    quantity: "1",
  });
  assert.deepEqual(nextIntakeFormAfterStock(current, false), current);
});

test("parseIntakePreferences reads persisted fair defaults", () => {
  const parsed = parseIntakePreferences(
    JSON.stringify({
      source: "  Vinted ",
      location: " Binder ",
      condition: " LP ",
      channel: "CARDMARKET",
      strategy: "patient",
      listingState: "ACTIVE",
      keepBuying: false,
    }),
  );

  assert.deepEqual(parsed, {
    source: "Vinted",
    location: "Binder",
    condition: "LP",
    channel: "CARDMARKET",
    strategy: "patient",
    listingState: "ACTIVE",
    keepBuying: false,
  });
});

test("parseIntakePreferences falls back on invalid saved values", () => {
  const parsed = parseIntakePreferences(
    JSON.stringify({
      source: "",
      location: "",
      condition: "",
      channel: "NOPE",
      strategy: "wild",
      listingState: "SOLD",
      keepBuying: "yes",
    }),
  );

  assert.deepEqual(parsed, DEFAULT_INTAKE_PREFERENCES);
  assert.deepEqual(parseIntakePreferences("bad json"), DEFAULT_INTAKE_PREFERENCES);
});

test("serializeIntakePreferences stores a normalized compact payload", () => {
  assert.equal(
    serializeIntakePreferences({
      ...DEFAULT_INTAKE_PREFERENCES,
      source: " Facebook ",
      location: " To list ",
      condition: " NM ",
    }),
    JSON.stringify({
      ...DEFAULT_INTAKE_PREFERENCES,
      source: "Facebook",
      location: "To list",
      condition: "NM",
    }),
  );
});
