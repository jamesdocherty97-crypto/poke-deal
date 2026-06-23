import assert from "node:assert/strict";
import test from "node:test";

import { nextIntakeFormAfterStock, parseIntakeQuantity } from "./intakeSession.js";

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
