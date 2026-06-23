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
});
