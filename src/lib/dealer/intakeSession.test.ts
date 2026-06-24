import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INTAKE_PREFERENCES,
  nextIntakeFormAfterStock,
  parseIntakePreferences,
  parseIntakeQuantity,
  serializeIntakePreferences,
} from "./intakeSession.js";

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
