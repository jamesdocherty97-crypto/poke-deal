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
  headlineNull?: boolean;
  confidence: "high" | "medium" | "low";
  manualCheck: boolean;
  ambiguous?: boolean;
  minAlternatives?: number;
  catalog?: {
    name: string;
    setName: string;
    number?: string;
  } | null;
  rationale: string;
};

const fixtureDir = path.join(process.cwd(), "src/lib/comps/__fixtures__/live-regression");

const expectations: FixtureExpectation[] = [
  {
    file: "alakazam-mep-0079-raw.json",
    band: [0, 0],
    headlineNull: true,
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Alakazam", setName: "Mega Evolution Promos", number: "MEP0079" },
    rationale: "Modern MEP promos can be stocked and manually checked even when live comp sources have no sales yet.",
  },
  {
    file: "blastoise-base-2-102-psa9.json",
    band: [35000, 45000],
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Blastoise", setName: "Base", number: "2/102" },
    rationale: "Vintage PSA 9 Blastoise should resolve the exact Base identity but stay manual-check because evidence is thin.",
  },
  {
    file: "blastoise-base-2-102-raw.json",
    band: [7000, 12000],
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Blastoise", setName: "Base", number: "2/102" },
    rationale: "Vintage raw Blastoise should resolve the Base identity and remain cautious.",
  },
  {
    file: "blastoise-xy-evolutions-raw.json",
    band: [500, 800],
    confidence: "low",
    manualCheck: true,
    ambiguous: true,
    minAlternatives: 3,
    catalog: { name: "Blastoise-EX", setName: "Evolutions", number: "21/108" },
    rationale: "Bare Blastoise + Evolutions stays ambiguous but can show its exact catalog match as an indicative guide.",
  },
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
    catalog: { name: "Charizard", setName: "Base", number: "4/102" },
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
    confidence: "medium",
    manualCheck: false,
    catalog: { name: "Charizard ex", setName: "151", number: "199/165" },
    rationale: "Single-provider PSA 10 Charizard ex data suppresses the impossible trend but remains usable at medium confidence.",
  },
  {
    file: "charizard-gx-hidden-fates-sv49-psa9.json",
    band: [0, 0],
    headlineNull: true,
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Charizard-GX", setName: "Hidden Fates Shiny Vault", number: "SV49/SV94" },
    rationale: "Shiny Vault identity should resolve even when PSA 9 source data is absent.",
  },
  {
    file: "dark-charizard-team-rocket-4-82-raw.json",
    band: [0, 0],
    headlineNull: true,
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Dark Charizard", setName: "Team Rocket", number: "4/82" },
    rationale: "WOTC non-Base chase cards should resolve identity but not headline excluded vintage raw catalog data.",
  },
  {
    file: "flittle-paldean-fates-raw.json",
    band: [100, 250],
    confidence: "low",
    manualCheck: true,
    ambiguous: true,
    minAlternatives: 1,
    catalog: { name: "Flittle", setName: "Paldean Fates", number: "164/91" },
    rationale: "Small modern raw cards can show conservative catalog context when a thin sold bucket is implausible, but remain manual-check.",
  },
  {
    file: "gengar-lost-origin-tg06-raw.json",
    band: [2500, 4500],
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06/TG30" },
    rationale: "Trainer Gallery numbers typed against the parent set resolve identity and use exact catalog context as a guide when sold data is rejected.",
  },
  {
    file: "hitmontop-neo-genesis-first-edition-raw.json",
    band: [0, 0],
    headlineNull: true,
    confidence: "low",
    manualCheck: true,
    minAlternatives: 4,
    catalog: null,
    rationale: "A likely wrong-set vintage first-edition line should fail gracefully with alternatives and no confident wrong card.",
  },
  {
    file: "japanese-vstar-universe-pikachu-205-raw.json",
    band: [0, 0],
    headlineNull: true,
    confidence: "low",
    manualCheck: true,
    minAlternatives: 4,
    catalog: { name: "Pikachu", setName: "VSTAR Universe", number: "205/172" },
    rationale: "Japanese-numbered input should never produce a priced English comp; no-data/manual is acceptable.",
  },
  {
    file: "lugia-neo-genesis-cgc10.json",
    band: [800000, 850000],
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Lugia", setName: "Neo Genesis", number: "9/111" },
    rationale: "CGC 10 vintage slabs can show an exact-grade one-sale guide while clearly blocking automatic pricing.",
  },
  {
    file: "lugia-neo-genesis-cgc15.json",
    band: [0, 0],
    headlineNull: true,
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Lugia", setName: "Neo Genesis", number: "9/111" },
    rationale: "Half-grade slab lookups should be accepted and fail safe when there are no matching sales.",
  },
  {
    file: "mewtwo-vstar-crown-zenith-gg44-psa9.json",
    band: [18000, 22000],
    confidence: "medium",
    manualCheck: false,
    catalog: { name: "Mewtwo VSTAR", setName: "Crown Zenith Galarian Gallery", number: "GG44/GG70" },
    rationale: "Galarian Gallery PSA 9 slabs with strong sample sizes should auto-comp cleanly.",
  },
  {
    file: "pawmi-paldean-fates-226-raw.json",
    band: [700, 1100],
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Pawmi", setName: "Paldean Fates", number: "226/91" },
    rationale: "Modern numbered input with a zero-padded denominator should match the API's unpadded collector number.",
  },
  {
    file: "pikachu-crown-zenith-gg30-raw.json",
    band: [7000, 9000],
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Pikachu", setName: "Crown Zenith Galarian Gallery", number: "GG30/GG70" },
    rationale: "Galarian Gallery parent-set input should resolve to the gallery subset identity.",
  },
  {
    file: "rough-blstoise-xy-evolutons-psa9.json",
    band: [0, 0],
    headlineNull: true,
    confidence: "low",
    manualCheck: true,
    ambiguous: true,
    minAlternatives: 3,
    catalog: { name: "Blastoise-EX", setName: "Evolutions", number: "21/108" },
    rationale: "Rough Quick Fill with set and name typos should still produce useful Evolutions candidates, not a blank search.",
  },
  {
    file: "rough-gengarr-lor-tg06-raw.json",
    band: [2500, 4500],
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06/TG30" },
    rationale: "Rough Quick Fill strips source/location noise, recovers identity, and returns an indicative catalog guide when sold data is rejected.",
  },
  {
    file: "rough-victni-promo-208-raw.json",
    band: [1000, 1600],
    confidence: "high",
    manualCheck: false,
    catalog: { name: "Victini", setName: "Scarlet & Violet Black Star Promos", number: "SVP208" },
    rationale: "Rough generic promo input should normalize to SVP 208 and auto-comp from PokeTrace.",
  },
  {
    file: "snivy-mep-049-raw.json",
    band: [1000, 1700],
    confidence: "medium",
    manualCheck: false,
    catalog: { name: "Snivy", setName: "Mega Evolution Promos", number: "MEP049" },
    rationale: "Future MEP promos should resolve from local identity fallback and use PokeTrace when available.",
  },
  {
    file: "tauros-chaos-rising-69-86-raw.json",
    band: [1, 50],
    confidence: "medium",
    manualCheck: false,
    catalog: { name: "Tauros", setName: "Chaos Rising", number: "69/86" },
    rationale: "ME-era zero-padded provider identities should resolve and headline from PokeTrace instead of being identity-gated out.",
  },
  {
    file: "umbreon-prismatic-evolutions-raw.json",
    band: [65000, 78000],
    confidence: "low",
    manualCheck: true,
    ambiguous: true,
    minAlternatives: 2,
    catalog: { name: "Umbreon ex", setName: "Prismatic Evolutions", number: "161/131" },
    rationale: "Bare Umbreon + Prismatic should surface variant ambiguity and force a manual check.",
  },
  {
    file: "victini-svp-208-raw.json",
    band: [1000, 1600],
    confidence: "high",
    manualCheck: false,
    catalog: { name: "Victini", setName: "Scarlet & Violet Black Star Promos", number: "SVP208" },
    rationale: "Modern promo Victini SVP 208 should auto-comp from the PokeTrace baseline without forcing manual solds.",
  },
  {
    file: "victini-svp-208-ace10.json",
    band: [0, 0],
    headlineNull: true,
    confidence: "low",
    manualCheck: true,
    minAlternatives: 1,
    catalog: { name: "Victini", setName: "Scarlet & Violet Black Star Promos", number: "SVP208" },
    rationale: "ACE slabs should be accepted for inventory/manual search even when automated graded sales are absent.",
  },
  {
    file: "zapdos-151-192-bgs95.json",
    band: [0, 0],
    headlineNull: true,
    confidence: "low",
    manualCheck: true,
    catalog: { name: "Zapdos ex", setName: "151", number: "192/165" },
    rationale: "BGS half-grade input should preserve the exact card identity and fail safe when no grade-specific sales exist.",
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
  assert.ok(files.length >= 20, `expected a broad corpus, got ${files.length}`);
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

      const headlinePence = result.reconciliation.headlinePence ?? result.headline?.medianPence ?? null;
      if (expectation.headlineNull) {
        assert.equal(result.headline, null);
        assert.equal(headlinePence, null);
      } else {
        assert.ok(
          headlinePence != null && headlinePence >= expectation.band[0] && headlinePence <= expectation.band[1],
          `${headlinePence} was outside ${expectation.band.join("-")}`,
        );
      }
      assert.equal(result.reconciliation.confidence, expectation.confidence);
      assert.equal(result.reconciliation.manualCheck, expectation.manualCheck);
      assert.equal(Boolean(fixture.response.ambiguous), Boolean(expectation.ambiguous));
      if (expectation.minAlternatives != null) {
        assert.ok((fixture.response.alternatives?.length ?? 0) >= expectation.minAlternatives);
      }
      if (expectation.catalog === null) {
        assert.equal(fixture.response.catalog, null);
      } else if (expectation.catalog) {
        assert.equal(fixture.response.catalog?.name, expectation.catalog.name);
        assert.equal(fixture.response.catalog?.setName, expectation.catalog.setName);
        if (expectation.catalog.number != null) {
          assert.equal(fixture.response.catalog?.number, expectation.catalog.number);
        }
      }
    } finally {
      Date.now = originalNow;
    }
  });
}

function readFixture(file: string): Fixture {
  return JSON.parse(readFileSync(path.join(fixtureDir, file), "utf8")) as Fixture;
}
