import assert from "node:assert/strict";
import test from "node:test";

import { latestProviderEvidenceForGroup, type CompAuditForDrift } from "./checkedProviderDrift.js";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const GROUP = { cardId: "card-1", grade: "RAW" as const, condition: "NM" as const };

test("checked-provider drift extracts recent providers from the latest persisted receipt", () => {
  const providers = latestProviderEvidenceForGroup([
    audit("2026-07-19T10:00:00.000Z", {
      all: [
        evidence("checked-comps", 60_000, 2),
        evidence("poketrace", 103_981, 50),
        evidence("pokemon-tcg-market", 58_000, 1),
      ],
    }),
  ], GROUP, NOW);

  assert.deepEqual(providers.map((provider) => provider.source), ["pokemon-tcg-market", "poketrace"]);
  assert.equal(providers.find((provider) => provider.source === "poketrace")?.medianPence, 103_981);
});

test("checked-provider drift stays condition scoped and rejects stale or empty evidence", () => {
  const providers = latestProviderEvidenceForGroup([
    { ...audit("2026-07-19T10:00:00.000Z", { all: [evidence("poketrace", 90_000, 20)] }), condition: "LP" },
    audit("2026-07-18T10:00:00.000Z", { all: [evidence("poketrace", 90_000, 0)] }),
    audit("2026-07-17T10:00:00.000Z", { all: [{ ...evidence("poketrace", 90_000, 20), asOf: "2026-03-01T10:00:00.000Z" }] }),
    audit("2026-07-16T10:00:00.000Z", { all: [{ ...evidence("poketrace", 90_000, 20), windowDays: 30 }] }),
  ], GROUP, NOW);

  assert.deepEqual(providers, []);
});

test("checked-provider drift keeps only the latest observation per provider", () => {
  const providers = latestProviderEvidenceForGroup([
    audit("2026-07-18T10:00:00.000Z", { all: [evidence("poketrace", 80_000, 10)] }),
    audit("2026-07-19T10:00:00.000Z", { all: [evidence("poketrace", 90_000, 12)] }),
  ], GROUP, NOW);

  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.medianPence, 90_000);
  assert.equal(providers[0]?.sampleSize, 12);
});

function audit(createdAt: string, receipt: unknown): CompAuditForDrift {
  return {
    cardId: GROUP.cardId,
    grade: GROUP.grade,
    condition: GROUP.condition,
    source: "checked-comps",
    medianPence: 60_000,
    sampleSize: 2,
    windowDays: 90,
    asOf: new Date("2026-07-18T12:00:00.000Z"),
    createdAt: new Date(createdAt),
    receipt,
  };
}

function evidence(source: string, medianPence: number, sampleSize: number) {
  return {
    source,
    medianPence,
    sampleSize,
    windowDays: 90,
    asOf: "2026-07-18T12:00:00.000Z",
  };
}
