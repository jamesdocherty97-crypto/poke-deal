import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_QUICK_HUNTS,
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
  });

  assert.deepEqual(pinned[0], {
    name: "Giratina VSTAR",
    setName: "Crown Zenith",
    number: "GG69/GG70",
    imageUrl: "https://images.pokemontcg.io/swsh12pt5gg/GG69_hires.png",
  });
  assert.equal(pinned.length, 5);
});

test("pinQuickHunt promotes duplicates instead of adding another copy", () => {
  const pinned = pinQuickHunt(DEFAULT_QUICK_HUNTS, { name: "Mew ex", setName: "Paldean Fates", number: "232/091" });

  assert.equal(pinned[0]?.name, "Mew ex");
  assert.equal(pinned[0]?.imageUrl, DEFAULT_QUICK_HUNTS[2]?.imageUrl);
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

  assert.deepEqual(removed.map((card) => card.name), ["Charizard ex", "Mew ex", "Umbreon VMAX"]);
});

test("parseQuickHunts reads persisted cards and falls back on bad data", () => {
  const persisted = serializeQuickHunts([
    { name: "Lugia V", setName: "Silver Tempest", number: "186/195" },
    { name: "Lugia V", setName: "Silver Tempest", number: "186/195" },
    { name: "", setName: "Silver Tempest", number: "186/195" },
  ]);

  assert.deepEqual(parseQuickHunts(persisted), [
    { name: "Lugia V", setName: "Silver Tempest", number: "186/195" },
  ]);
  assert.deepEqual(parseQuickHunts("{nope}"), DEFAULT_QUICK_HUNTS);
});
