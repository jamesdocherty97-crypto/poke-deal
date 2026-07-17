import test from "node:test";
import assert from "node:assert/strict";
import type { CatalogCard } from "../catalog/types.js";
import type { ScanIdentity } from "./cardScan.js";
import {
  canonicalGrade,
  normalizePrintedNumber,
  scanIdentityToQuery,
} from "./scanIdentityMapper.js";

function identity(overrides: Partial<ScanIdentity>): ScanIdentity {
  return {
    name: "Umbreon VMAX",
    setName: "Evolving Skies",
    setCode: null,
    number: "215/203",
    language: "English",
    edition: null,
    finish: null,
    tcgApiId: null,
    tcgDexId: null,
    cardmarketId: null,
    unresolvedIdentityHints: [],
    isSlab: false,
    grader: null,
    grade: null,
    certNumber: null,
    stamps: [],
    readable: true,
    notes: "",
    ...overrides,
  };
}

function card(name: string, setName: string, number: string): CatalogCard {
  return {
    game: "POKEMON",
    language: "EN",
    name,
    setName,
    number,
  };
}

test("scanIdentityToQuery maps a standard set-code scan to an existing comp query", () => {
  const mapped = scanIdentityToQuery(identity({ setName: null, setCode: "EVS" }));
  assert.equal(mapped.status, "ready");
  if (mapped.status !== "ready") throw new Error("expected ready");
  assert.equal(mapped.query.name, "Umbreon VMAX");
  assert.equal(mapped.query.setName, "Evolving Skies");
  assert.equal(mapped.query.number, "215/203");
  assert.equal(mapped.query.grade, "RAW");
  assert.equal(mapped.query.language, "EN");
});

test("scanIdentityToQuery canonicalizes ME-era zero-padded numeric numbers", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "Tauros",
    setName: "ME04: Chaos Rising",
    setCode: null,
    number: "069/086",
  }));
  assert.equal(mapped.status, "ready");
  if (mapped.status !== "ready") throw new Error("expected ready");
  assert.equal(mapped.query.name, "Tauros");
  assert.equal(mapped.query.setName, "Chaos Rising");
  assert.equal(mapped.query.number, "69/86");
});

test("scanIdentityToQuery preserves TG/GG collector numbers and resolves gallery sets from set code", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "Gengar",
    setName: null,
    setCode: "LOR",
    number: "TG06/TG30",
  }));
  assert.equal(mapped.status, "ready");
  if (mapped.status !== "ready") throw new Error("expected ready");
  assert.equal(mapped.query.setName, "Lost Origin Trainer Gallery");
  assert.equal(mapped.query.number, "TG06/TG30");
});

test("scanIdentityToQuery normalizes modern promo wording without relying on artwork", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "Victini",
    setName: null,
    setCode: "SVP",
    number: "SVP EN 208",
  }));
  assert.equal(mapped.status, "ready");
  if (mapped.status !== "ready") throw new Error("expected ready");
  assert.equal(mapped.query.setName, "Scarlet & Violet Black Star Promos");
  assert.equal(mapped.query.number, "SVP 208");
});

test("scanIdentityToQuery flags name plus number with no set for an ambiguity picker", () => {
  const mapped = scanIdentityToQuery(
    identity({ name: "Blastoise", setName: null, setCode: null, number: "2/102" }),
    {
      alternatives: [
        card("Blastoise", "Base", "2/102"),
        card("Blastoise", "Celebrations: Classic Collection", "2/102"),
      ],
    },
  );
  assert.equal(mapped.status, "ambiguous");
  if (mapped.status !== "ambiguous") throw new Error("expected ambiguous");
  assert.equal(mapped.alternatives.length, 2);
});

test("scanIdentityToQuery never comps an unreadable/null number from a guessed identity", () => {
  const mapped = scanIdentityToQuery(identity({ number: null, notes: "number blurry" }));
  assert.equal(mapped.status, "manual");
  if (mapped.status !== "manual") throw new Error("expected manual");
  assert.match(mapped.reason, /collector number/i);
  assert.match(mapped.quickFill, /Umbreon VMAX/);
});

test("scanIdentityToQuery allows a sufficiently identified Japanese card and keeps JP in the comp query", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "リザードン",
    setName: "ポケモンカード151",
    setCode: "SV2a",
    number: "006/165",
    language: "Japanese",
  }));
  assert.equal(mapped.status, "ready");
  if (mapped.status !== "ready") throw new Error("expected ready");
  assert.equal(mapped.query.language, "JP");
  assert.equal(mapped.query.name, "リザードン");
  assert.match(mapped.quickFill, /JP/);
  assert.match(mapped.warnings.join(" "), /Japanese identity/i);
});

test("scanIdentityToQuery rejects unsupported languages without relabelling them English", () => {
  const mapped = scanIdentityToQuery(identity({ language: "French" }));
  assert.equal(mapped.status, "manual");
  if (mapped.status !== "manual") throw new Error("expected manual");
  assert.match(mapped.reason, /French scan is not supported/i);
});

test("scanIdentityToQuery requires a set or exact provider identity for Japanese ambiguity", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "リザードン",
    setName: null,
    setCode: null,
    number: "006/165",
    language: "Japanese",
  }));
  assert.equal(mapped.status, "manual");
  if (mapped.status !== "manual") throw new Error("expected manual");
  assert.match(mapped.reason, /Japanese scan needs a readable set/i);
});

test("scanIdentityToQuery politely refuses non-card photos", () => {
  const mapped = scanIdentityToQuery(identity({
    name: null,
    setName: null,
    number: null,
    readable: false,
    notes: "not a pokemon card",
  }));
  assert.equal(mapped.status, "manual");
  if (mapped.status !== "manual") throw new Error("expected manual");
  assert.match(mapped.reason, /does not look/i);
});

test("scanIdentityToQuery preserves first edition as structured and provider-compatible query identity", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "Hitmontop",
    setName: "Neo Genesis",
    number: "3/111",
    edition: "FIRST_EDITION",
    stamps: ["1st Edition"],
  }));
  assert.equal(mapped.status, "ready");
  if (mapped.status !== "ready") throw new Error("expected ready");
  assert.equal(mapped.query.edition, "FIRST_EDITION");
  assert.match(mapped.query.name, /1st Edition/);
  assert.match(mapped.warnings.join(" "), /1st Edition/);
  assert.doesNotMatch(mapped.warnings.join(" "), /unlimited printing/i);
});

test("scanIdentityToQuery preserves Shadowless rather than silently treating it as Unlimited", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "Charizard",
    setName: "Base",
    number: "4/102",
    stamps: ["Shadowless"],
  }));
  assert.equal(mapped.status, "ready");
  if (mapped.status !== "ready") throw new Error("expected ready");
  assert.equal(mapped.query.edition, "SHADOWLESS");
  assert.match(mapped.query.name, /Shadowless/);
});

test("scanIdentityToQuery keeps Staff and Reverse Holo as independent print dimensions", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "Mew ex",
    setName: "Scarlet & Violet Black Star Promos",
    number: "SVP 053",
    stamps: ["STAFF", "Reverse Holo"],
  }));
  assert.equal(mapped.status, "ready");
  if (mapped.status !== "ready") throw new Error("expected ready");
  assert.equal(mapped.query.edition, "STAFF");
  assert.equal(mapped.query.finish, "REVERSE_HOLO");
  assert.match(mapped.query.name, /Staff/);
  assert.match(mapped.query.name, /Reverse Holo/);
});

test("scanIdentityToQuery keeps Prerelease and Holo explicit", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "Charizard",
    setName: "Vivid Voltage",
    number: "025/185",
    edition: "PRERELEASE",
    finish: "HOLO",
  }));
  assert.equal(mapped.status, "ready");
  if (mapped.status !== "ready") throw new Error("expected ready");
  assert.equal(mapped.query.edition, "PRERELEASE");
  assert.equal(mapped.query.finish, "HOLO");
});

test("scanIdentityToQuery blocks compound edition marks the structured domain cannot represent", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "Charizard",
    setName: "Base",
    number: "4/102",
    stamps: ["1st Edition", "Shadowless"],
  }));
  assert.equal(mapped.status, "manual");
  if (mapped.status !== "manual") throw new Error("expected manual");
  assert.match(mapped.reason, /Conflicting edition marks/i);
  assert.match(mapped.quickFill, /1st Edition/);
  assert.match(mapped.quickFill, /Shadowless/);
});

test("scanIdentityToQuery blocks unsupported special print and foil treatments", () => {
  const winner = scanIdentityToQuery(identity({ stamps: ["Winner stamp"] }));
  const cosmos = scanIdentityToQuery(identity({ stamps: ["Cosmos Holo"] }));
  assert.equal(winner.status, "manual");
  assert.equal(cosmos.status, "manual");
  if (winner.status !== "manual" || cosmos.status !== "manual") throw new Error("expected manual");
  assert.match(winner.reason, /Unsupported print identity/i);
  assert.match(cosmos.reason, /Unsupported print identity/i);
});

test("scanIdentityToQuery does not silently assume Unlimited for edition-sensitive vintage sets", () => {
  const unknown = scanIdentityToQuery(identity({
    name: "Hitmontop",
    setName: "Neo Genesis",
    number: "3/111",
  }));
  const unlimited = scanIdentityToQuery(identity({
    name: "Hitmontop",
    setName: "Neo Genesis",
    number: "3/111",
    edition: "UNLIMITED",
  }));
  assert.equal(unknown.status, "manual");
  if (unknown.status !== "manual") throw new Error("expected manual");
  assert.match(unknown.reason, /Edition is not confirmed/i);
  assert.equal(unlimited.status, "ready");
  if (unlimited.status !== "ready") throw new Error("expected ready");
  assert.equal(unlimited.query.edition, "UNLIMITED");
});

test("scanIdentityToQuery preserves exact provider identity hints", () => {
  const mapped = scanIdentityToQuery(identity({
    tcgApiId: "swsh7-215",
    tcgDexId: "swsh7-215",
    cardmarketId: "567890",
  }));
  assert.equal(mapped.status, "ready");
  if (mapped.status !== "ready") throw new Error("expected ready");
  assert.equal(mapped.query.tcgApiId, "swsh7-215");
  assert.equal(mapped.query.tcgDexId, "swsh7-215");
  assert.equal(mapped.query.cardmarketId, "567890");
});

test("scanIdentityToQuery routes PSA slab certs through cert verification", () => {
  const mapped = scanIdentityToQuery(identity({
    isSlab: true,
    grader: "PSA",
    grade: "GEM MT 10",
    certNumber: "81234567",
  }));
  assert.equal(mapped.status, "psa-cert");
  if (mapped.status !== "psa-cert") throw new Error("expected psa-cert");
  assert.equal(mapped.query.grade, "PSA_10");
  assert.equal(mapped.certNumber, "81234567");
});

test("scanIdentityToQuery requires confirmation for non-PSA slab reads", () => {
  const mapped = scanIdentityToQuery(identity({
    isSlab: true,
    grader: "CGC",
    grade: "9.5",
    certNumber: "12345",
  }));
  assert.equal(mapped.status, "confirm-slab");
  if (mapped.status !== "confirm-slab") throw new Error("expected confirm-slab");
  assert.equal(mapped.query.grade, "CGC_9_5");
});

test("canonicalGrade supports half grades where the domain supports them", () => {
  assert.equal(canonicalGrade("BGS", "8.5"), "BGS_8_5");
  assert.equal(canonicalGrade("CGC", "1.5"), "CGC_1_5");
  assert.equal(canonicalGrade("ACE", "10"), "ACE_10");
  assert.equal(canonicalGrade("PSA", "9.5"), null);
});

test("normalizePrintedNumber formats promo and gallery scans", () => {
  assert.equal(normalizePrintedNumber("SVP EN 208"), "SVP 208");
  assert.equal(normalizePrintedNumber("MEP049"), "MEP 049");
  assert.equal(normalizePrintedNumber("GG 30 / GG 70"), "GG30/GG70");
  assert.equal(normalizePrintedNumber("069/086"), "69/86");
  assert.equal(normalizePrintedNumber("096/086"), "96/86");
});
