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

test("scanIdentityToQuery sends non-English cards to manual comp for now", () => {
  const mapped = scanIdentityToQuery(identity({ language: "Japanese" }));
  assert.equal(mapped.status, "manual");
  if (mapped.status !== "manual") throw new Error("expected manual");
  assert.match(mapped.reason, /Non-English/i);
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

test("scanIdentityToQuery warns but allows 1st Edition and Shadowless comps", () => {
  const mapped = scanIdentityToQuery(identity({
    name: "Hitmontop",
    setName: "Neo Genesis",
    number: "3/111",
    stamps: ["1st Edition", "Shadowless"],
  }));
  assert.equal(mapped.status, "ready");
  assert.match(mapped.warnings.join(" "), /1st Edition/);
  assert.match(mapped.warnings.join(" "), /Shadowless/);
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
});
