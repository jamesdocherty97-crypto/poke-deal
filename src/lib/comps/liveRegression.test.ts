import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { pickHeadlineForQuery } from "./compService.js";
import type { CardRef, CompQuery, CompResult } from "../domain/types.js";
import type { ReconciledComp } from "./compService.js";

type Fixture = {
  capturedAt: string;
  request: {
    card: CardRef;
    grade: CompQuery["grade"];
  };
  response: ReconciledComp & {
    ambiguous?: boolean;
    alternatives?: unknown[];
    catalog?: CardRef | null;
  };
};

type FixtureExpectation = {
  file: string;
  band: [number, number];
  confidence: "high" | "medium" | "low";
  manualCheck: boolean;
  ambiguous?: boolean;
  minAlternatives?: number;
  rationale: string;
};

const fixtureDir = path.join(process.cwd(), "src/lib/comps/__fixtures__/live-regression");

const expectations: FixtureExpectation[] = [
  {
    file: "umbreon-evolving-skies-raw-ambiguous.json",
    band: [4000, 7000],
    confidence: "medium",
    manualCheck: true,
    ambiguous: true,
    minAlternatives: 5,
    rationale: "Bare Umbreon + Evolving Skies must stay ambiguous and use a conservative raw baseline, not a sibling chase card.",
  },
  {
    file: "charizard-base-4-102-raw.json",
    band: [20000, 30000],
    confidence: "low",
    manualCheck: true,
    rationale: "Vintage raw Base Charizard has noisy external baselines, so it must remain manual-check even with a headline.",
  },
  {
    file: "umbreon-vmax-215-203-raw.json",
    band: [170000, 185000],
    confidence: "medium",
    manualCheck: true,
    rationale: "Moonbreon raw buckets are contaminated; the app should surface a plausible headline but still require manual check.",
  },
  {
    file: "charizard-ex-151-199-165-psa10.json",
    band: [100000, 112000],
    confidence: "low",
    manualCheck: true,
    rationale: "Single-provider PSA 10 Charizard ex data is useful but spread/trend risk keeps it check-before-buy.",
  },
  {
    file: "victini-svp-208-raw.json",
    band: [1000, 1600],
    confidence: "high",
    manualCheck: false,
    rationale: "Modern promo Victini SVP 208 should auto-comp from the PokeTrace baseline without forcing manual solds.",
  },
  {
    file: "zapdos-151-192-raw.json",
    band: [800, 1800],
    confidence: "low",
    manualCheck: true,
    rationale: "Zapdos 192 raw has agreeing low-value signals but should stay cautious because the headline is broad non-UK data.",
  },
];

test("live regression fixture directory has exactly the pinned basket", () => {
  const files = readdirSync(fixtureDir).filter((file) => file.endsWith(".json")).sort();
  assert.deepEqual(files, expectations.map((item) => item.file).sort());
});

for (const expectation of expectations) {
  test(`fixture ${expectation.file}: ${expectation.rationale}`, () => {
    const fixture = readFixture(expectation.file);
    const originalNow = Date.now;
    Date.now = () => new Date(fixture.capturedAt).getTime();
    try {
      const card = fixture.response.catalog ?? fixture.request.card;
      const query: CompQuery = { grade: fixture.request.grade };
      const result = pickHeadlineForQuery(fixture.response.all as CompResult[], card, query, {
        ambiguous: Boolean(fixture.response.ambiguous),
      });

      assert.ok(
        result.reconciliation.headlinePence != null &&
          result.reconciliation.headlinePence >= expectation.band[0] &&
          result.reconciliation.headlinePence <= expectation.band[1],
        `${result.reconciliation.headlinePence} was outside ${expectation.band.join("-")}`,
      );
      assert.equal(result.reconciliation.confidence, expectation.confidence);
      assert.equal(result.reconciliation.manualCheck, expectation.manualCheck);
      assert.equal(Boolean(fixture.response.ambiguous), Boolean(expectation.ambiguous));
      if (expectation.minAlternatives != null) {
        assert.ok((fixture.response.alternatives?.length ?? 0) >= expectation.minAlternatives);
      }
    } finally {
      Date.now = originalNow;
    }
  });
}

function readFixture(file: string): Fixture {
  return JSON.parse(readFileSync(path.join(fixtureDir, file), "utf8")) as Fixture;
}
