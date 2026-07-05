import assert from "node:assert/strict";
import test from "node:test";
import { runPricingBrainAttackSuite } from "./redteamPricingBrain.attacks.js";

test("pricing brain red-team attack suite is executable evidence", () => {
  const attacks = runPricingBrainAttackSuite();

  assert.equal(attacks.length, 10);
  assert.deepEqual(
    attacks.map((attack) => attack.id),
    ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"],
  );

  for (const attack of attacks) {
    assert.ok(attack.setup.length > 20, `${attack.id} setup should be explicit`);
    assert.ok(attack.expectedHonestBehaviour.length > 20, `${attack.id} expected behaviour should be explicit`);
    assert.ok(["SURVIVES", "DEGRADED", "FAILS"].includes(attack.verdict), `${attack.id} verdict should be classified`);
    assert.ok(Number.isFinite(attack.moneyAtRiskPence), `${attack.id} should rank money at risk`);
  }

  assert.deepEqual(
    attacks.filter((attack) => attack.verdict === "FAILS").map((attack) => attack.id),
    [],
  );

  const byId = new Map(attacks.map((attack) => [attack.id, attack]));
  assert.ok(byId.get("A2")?.reconciler?.reasons.includes("stale-consensus"));
  assert.ok(byId.get("A4")?.reconciler?.reasons.includes("grade-bleed-suspect"));
  assert.ok(byId.get("A5")?.reconciler?.reasons.includes("fx-aged"));
  assert.ok(byId.get("A9")?.reconciler?.reasons.includes("uk-solds-disagree"));
});
