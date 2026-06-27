import assert from "node:assert/strict";
import test from "node:test";

import { parseQuickIntake } from "./intakeParser.js";

test("parseQuickIntake fills a Lost Origin trainer gallery raw buy", () => {
  assert.deepEqual(parseQuickIntake("Gengar Lost Origin TG06 raw £10"), {
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    number: "TG06",
    grade: "RAW",
    cost: "10.00",
  });
});

test("parseQuickIntake keeps card ex names while parsing set, quantity and slab grade", () => {
  assert.deepEqual(parseQuickIntake("2x Pikachu ex Surging Sparks 238/191 PSA 10 £200"), {
    name: "Pikachu ex",
    setName: "Surging Sparks",
    number: "238/191",
    grade: "PSA_10",
    cost: "200.00",
    quantity: "2",
  });
});

test("parseQuickIntake handles gallery aliases and BGS decimal grades", () => {
  assert.deepEqual(parseQuickIntake("Giratina VSTAR cz gg GG69/GG70 bgs 9.5 £80"), {
    name: "Giratina VSTAR",
    setName: "Crown Zenith Galarian Gallery",
    number: "GG69/GG70",
    grade: "BGS_9_5",
    cost: "80.00",
  });
});

test("parseQuickIntake resolves vintage dealer shorthand", () => {
  assert.deepEqual(parseQuickIntake("Charizard base set 4/102"), {
    name: "Charizard",
    setName: "Base",
    number: "4/102",
  });

  assert.deepEqual(parseQuickIntake("Hitmontop Neo Genesis 1st Edition LP"), {
    name: "Hitmontop 1st Edition",
    setName: "Neo Genesis",
    condition: "LP",
  });

  assert.deepEqual(parseQuickIntake("Neo Genesis 1st ed Hitmontop LP £35 raw"), {
    name: "Hitmontop 1st Edition",
    setName: "Neo Genesis",
    condition: "LP",
    grade: "RAW",
    cost: "35.00",
  });
});

test("parseQuickIntake resolves Mega Evolution promo shorthand", () => {
  assert.deepEqual(parseQuickIntake("Snivy MEP 049 raw £2"), {
    name: "Snivy",
    setName: "Mega Evolution Promos",
    number: "MEP049",
    grade: "RAW",
    cost: "2.00",
  });

  assert.deepEqual(parseQuickIntake("Snivy MEP049 raw £2"), {
    name: "Snivy",
    setName: "Mega Evolution Promos",
    number: "MEP049",
    grade: "RAW",
    cost: "2.00",
  });

  assert.deepEqual(parseQuickIntake("Snivy XYZ001 raw £2"), {
    name: "Snivy",
    number: "XYZ001",
    grade: "RAW",
    cost: "2.00",
  });

  assert.deepEqual(parseQuickIntake("Snivy XYZ 001 raw £2"), {
    name: "Snivy",
    number: "XYZ001",
    grade: "RAW",
    cost: "2.00",
  });
});

test("parseQuickIntake resolves parenthesised modern promo shorthand", () => {
  assert.deepEqual(parseQuickIntake("Victini 208 IR Promo (SVP) ACE 10 £40"), {
    name: "Victini",
    setName: "Scarlet & Violet Black Star Promos",
    number: "SVP208",
    grade: "ACE_10",
    cost: "40.00",
  });

  assert.deepEqual(parseQuickIntake("Alakazam MEP0079 raw £5"), {
    name: "Alakazam",
    setName: "Mega Evolution Promos",
    number: "MEP0079",
    grade: "RAW",
    cost: "5.00",
  });
});

test("parseQuickIntake accepts low CGC half grades", () => {
  assert.deepEqual(parseQuickIntake("Lugia Neo Genesis CGC 1.5 £80"), {
    name: "Lugia",
    setName: "Neo Genesis",
    grade: "CGC_1_5",
    cost: "80.00",
  });
});

test("parseQuickIntake accepts broader slab grades", () => {
  assert.deepEqual(parseQuickIntake("Charizard base set 4/102 psa8 £300"), {
    name: "Charizard",
    setName: "Base",
    number: "4/102",
    grade: "PSA_8",
    cost: "300.00",
  });

  assert.deepEqual(parseQuickIntake("Gengar lost origin TG06 CGC 9.5 £20"), {
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    number: "TG06",
    grade: "CGC_9_5",
    cost: "20.00",
  });

  assert.deepEqual(parseQuickIntake("Charizard 151 199/165 ACE 10 £120"), {
    name: "Charizard",
    setName: "151",
    number: "199/165",
    grade: "ACE_10",
    cost: "120.00",
  });

  assert.deepEqual(parseQuickIntake("Charizard ex 151 199/165 PSA 10 £700 cert 84213567 slabs"), {
    name: "Charizard ex",
    setName: "151",
    number: "199/165",
    grade: "PSA_10",
    cost: "700.00",
    location: "Slabs",
    graderCert: "84213567",
  });
});

test("parseQuickIntake captures fair-flow source, location and condition", () => {
  assert.deepEqual(parseQuickIntake("Gengar lor tg TG06 raw £10 LP vinted binder"), {
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    number: "TG06",
    grade: "RAW",
    cost: "10.00",
    source: "Vinted",
    location: "Binder",
    condition: "LP",
  });

  assert.deepEqual(parseQuickIntake("2x Charizard 151 199/165 £18 from card fair box a nm"), {
    name: "Charizard",
    setName: "151",
    number: "199/165",
    cost: "18.00",
    quantity: "2",
    source: "Card fair",
    location: "Box A",
    condition: "NM",
  });

  assert.deepEqual(parseQuickIntake("Gengar lor tg TG06 raw £10 each LP vinted binder"), {
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    number: "TG06",
    grade: "RAW",
    cost: "10.00",
    source: "Vinted",
    location: "Binder",
    condition: "LP",
  });

  assert.deepEqual(parseQuickIntake("Bought Snivy MEP 049 raw for £4"), {
    name: "Snivy",
    setName: "Mega Evolution Promos",
    number: "MEP049",
    grade: "RAW",
    cost: "4.00",
  });
});

test("parseQuickIntake splits explicit bundle totals into per-card cost", () => {
  assert.deepEqual(parseQuickIntake("2x Charizard 151 199/165 £18 total from card fair box a nm"), {
    name: "Charizard",
    setName: "151",
    number: "199/165",
    cost: "9.00",
    costMode: "TOTAL_SPLIT",
    quantity: "2",
    source: "Card fair",
    location: "Box A",
    condition: "NM",
  });

  assert.deepEqual(parseQuickIntake("3x Gengar lor tg TG06 bundle £10 raw"), {
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    number: "TG06",
    grade: "RAW",
    cost: "3.33",
    costMode: "TOTAL_SPLIT",
    quantity: "3",
  });

  assert.deepEqual(parseQuickIntake("3 for £25 Pikachu 151 173/165 raw nm card fair"), {
    name: "Pikachu",
    setName: "151",
    number: "173/165",
    grade: "RAW",
    cost: "8.33",
    costMode: "TOTAL_SPLIT",
    quantity: "3",
    source: "Card fair",
    condition: "NM",
  });
});

test("parseQuickIntake captures explicit listing channel and state", () => {
  assert.deepEqual(parseQuickIntake("Gengar lor tg TG06 raw £10 from vinted binder list on ebay draft"), {
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    number: "TG06",
    grade: "RAW",
    cost: "10.00",
    source: "Vinted",
    location: "Binder",
    channel: "EBAY",
    listingState: "DRAFT",
  });

  assert.deepEqual(parseQuickIntake("Snivy MEP 049 raw £2 card fair sell on vinted active"), {
    name: "Snivy",
    setName: "Mega Evolution Promos",
    number: "MEP049",
    grade: "RAW",
    cost: "2.00",
    source: "Card fair",
    channel: "VINTED",
    listingState: "ACTIVE",
  });
});
