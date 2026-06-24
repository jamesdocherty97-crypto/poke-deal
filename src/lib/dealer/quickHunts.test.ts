import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_QUICK_HUNTS,
  MAX_QUICK_HUNTS,
  parseQuickHunts,
  pinQuickHunt,
  removeQuickHunt,
  serializeQuickHunts,
} from "./quickHunts.js";

test("pinQuickHunt puts the selected card first and trims whitespace", () => {
  const pinned = pinQuickHunt(DEFAULT_QUICK_HUNTS, {
    name: "  Giratina VSTAR  ",
    setName: " Crown Zenith ",
    number: " GG69/GG70 ",
    imageUrl: " https://images.pokemontcg.io/swsh12pt5gg/GG69_hires.png ",
    setMarkUrl: " https://images.pokemontcg.io/swsh12pt5gg/logo.png ",
  });

  assert.deepEqual(pinned[0], {
    name: "Giratina VSTAR",
    setName: "Crown Zenith",
    number: "GG69/GG70",
    imageUrl: "https://images.pokemontcg.io/swsh12pt5gg/GG69_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/swsh12pt5gg/logo.png",
  });
  assert.equal(pinned.length, Math.min(DEFAULT_QUICK_HUNTS.length + 1, MAX_QUICK_HUNTS));
});

test("pinQuickHunt promotes duplicates and keeps source-backed images", () => {
  const pinned = pinQuickHunt(DEFAULT_QUICK_HUNTS, { name: "Mew ex", setName: "Paldean Fates", number: "232/091" });

  assert.equal(pinned[0]?.name, "Mew ex");
  assert.equal(pinned[0]?.imageUrl, DEFAULT_QUICK_HUNTS[2]?.imageUrl);
  assert.equal(pinned[0]?.setMarkUrl, DEFAULT_QUICK_HUNTS[2]?.setMarkUrl);
  assert.equal(pinned.length, DEFAULT_QUICK_HUNTS.length);
  assert.equal(pinned.filter((card) => card.name === "Mew ex").length, 1);
});

test("pinQuickHunt enforces the max card count", () => {
  const pinned = pinQuickHunt(
    DEFAULT_QUICK_HUNTS,
    { name: "Rayquaza VMAX", setName: "Evolving Skies", number: "218/203" },
    4,
  );

  assert.deepEqual(pinned.map((card) => card.name), [
    "Rayquaza VMAX",
    "Charizard ex",
    "Pikachu ex",
    "Mew ex",
  ]);
});

test("removeQuickHunt removes by card identity", () => {
  const removed = removeQuickHunt(DEFAULT_QUICK_HUNTS, {
    name: "pikachu ex",
    setName: "surging sparks",
    number: "238/191",
  });

  assert.equal(removed.length, DEFAULT_QUICK_HUNTS.length - 1);
  assert.equal(removed.some((card) => card.name === "Pikachu ex"), false);
  assert.equal(removed[0]?.name, "Charizard ex");
});

test("DEFAULT_QUICK_HUNTS covers common modern, promo and vintage comp shapes", () => {
  assert.equal(DEFAULT_QUICK_HUNTS.length, MAX_QUICK_HUNTS);
  assert.ok(DEFAULT_QUICK_HUNTS.some((card) => card.setName.includes("Trainer Gallery") && card.number.startsWith("TG")));
  assert.ok(DEFAULT_QUICK_HUNTS.some((card) => card.setName.includes("Galarian Gallery") && card.number.startsWith("GG")));
  assert.ok(DEFAULT_QUICK_HUNTS.some((card) => card.number.startsWith("SVP")));
  assert.ok(DEFAULT_QUICK_HUNTS.some((card) => card.number.startsWith("MEP")));
  assert.ok(DEFAULT_QUICK_HUNTS.some((card) => card.setName === "Base" && card.number === "4/102"));
});

test("parseQuickHunts reads persisted cards and falls back on bad data", () => {
  const persisted = serializeQuickHunts([
    { name: "Lugia V", setName: "Silver Tempest", number: "186/195", setMarkUrl: " https://images.pokemontcg.io/swsh12/logo.png " },
    { name: "Lugia V", setName: "Silver Tempest", number: "186/195" },
    { name: "", setName: "Silver Tempest", number: "186/195" },
  ]);

  assert.deepEqual(parseQuickHunts(persisted), [
    {
      name: "Lugia V",
      setName: "Silver Tempest",
      number: "186/195",
      imageUrl: "https://images.pokemontcg.io/swsh12/186_hires.png",
      setMarkUrl: "https://images.pokemontcg.io/swsh12/logo.png",
    },
  ]);
  assert.deepEqual(parseQuickHunts("{nope}"), DEFAULT_QUICK_HUNTS);
});

test("parseQuickHunts backfills built-in card images for older saved picks", () => {
  const persisted = JSON.stringify([{ name: "Charizard ex", setName: "151", number: "199/165" }]);
  const parsed = parseQuickHunts(persisted);

  assert.equal(parsed[0]?.imageUrl, DEFAULT_QUICK_HUNTS[0]?.imageUrl);
  assert.equal(parsed[0]?.setMarkUrl, DEFAULT_QUICK_HUNTS[0]?.setMarkUrl);
});
