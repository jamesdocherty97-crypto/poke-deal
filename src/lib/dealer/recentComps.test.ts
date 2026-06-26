import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RECENT_COMPS,
  parseRecentComps,
  pinRecentComp,
  recentCompKey,
  removeRecentComp,
  serializeRecentComps,
  type RecentCompEntry,
} from "./recentComps.js";

const baseComp: RecentCompEntry = {
  name: "Gengar",
  setName: "Lost Origin Trainer Gallery",
  number: "TG06/TG30",
  grade: "RAW",
  pricePence: 1200,
  lowPence: 900,
  highPence: 1500,
  sampleSize: 6,
  windowDays: 30,
  source: "pokemon-price-tracker",
  confidenceLabel: "Usable",
  confidenceTone: "good",
  imageUrl: "https://images.pokemontcg.io/swsh11tg/TG06_hires.png",
  setMarkUrl: "https://images.pokemontcg.io/swsh11tg/logo.png",
  lookedUpAt: "2026-06-24T10:00:00.000Z",
};

test("pinRecentComp puts the latest comp first and trims text", () => {
  const pinned = pinRecentComp([], {
    ...baseComp,
    name: " Gengar ",
    setName: " Lost Origin Trainer Gallery ",
    number: " TG06/TG30 ",
    grade: " RAW ",
  });

  assert.deepEqual(pinned[0], baseComp);
});

test("pinRecentComp promotes duplicate cards and keeps previous artwork", () => {
  const first = pinRecentComp([], baseComp);
  const second = pinRecentComp(first, {
    ...baseComp,
    pricePence: 1400,
    imageUrl: undefined,
    setMarkUrl: undefined,
    lookedUpAt: "2026-06-24T11:00:00.000Z",
  });

  assert.equal(second.length, 1);
  assert.equal(second[0]?.pricePence, 1400);
  assert.equal(second[0]?.imageUrl, baseComp.imageUrl);
  assert.equal(second[0]?.setMarkUrl, baseComp.setMarkUrl);
});

test("pinRecentComp treats first-edition shorthand as the same recent card", () => {
  const firstEditionComp: RecentCompEntry = {
    ...baseComp,
    name: "1st Edition Hitmontop",
    setName: "Neo Genesis",
    number: "",
    pricePence: 0,
    lowPence: 0,
    highPence: 0,
    sampleSize: 0,
  };

  const first = pinRecentComp([], firstEditionComp);
  const second = pinRecentComp(first, {
    ...firstEditionComp,
    name: "1st Ed Hitmontop",
    lookedUpAt: "2026-06-24T11:00:00.000Z",
  });

  assert.equal(second.length, 1);
  assert.equal(second[0]?.name, "1st Ed Hitmontop");
});

test("pinRecentComp caps the recent list", () => {
  const entries = Array.from({ length: MAX_RECENT_COMPS + 2 }, (_, index) => ({
    ...baseComp,
    name: `Card ${index}`,
    number: String(index),
  }));
  const pinned = entries.reduce<RecentCompEntry[]>((rows, entry) => pinRecentComp(rows, entry), []);

  assert.equal(pinned.length, MAX_RECENT_COMPS);
  assert.equal(pinned[0]?.name, `Card ${MAX_RECENT_COMPS + 1}`);
});

test("parseRecentComps normalizes, dedupes and ignores malformed rows", () => {
  const parsed = parseRecentComps(
    serializeRecentComps([
      baseComp,
      { ...baseComp, name: "gengar", setName: "lost origin trainer gallery", pricePence: 999 },
      { ...baseComp, name: "" },
    ]),
  );

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.pricePence, baseComp.pricePence);
  assert.deepEqual(parseRecentComps("nope"), []);
});

test("parseRecentComps dedupes stored first-edition spelling variants", () => {
  const parsed = parseRecentComps(
    JSON.stringify([
      { ...baseComp, name: "1st Ed Hitmontop", setName: "Neo Genesis", number: "" },
      { ...baseComp, name: "First Edition Hitmontop", setName: "Neo Genesis", number: "", pricePence: 999 },
    ]),
  );

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.name, "1st Ed Hitmontop");
});

test("removeRecentComp removes by card and grade identity", () => {
  const psa = { ...baseComp, grade: "PSA_10", pricePence: 8500 };
  const removed = removeRecentComp([baseComp, psa], {
    ...baseComp,
    name: "gengar",
    setName: "lost origin trainer gallery",
  });

  assert.deepEqual(removed, [psa]);
});

test("recentCompKey includes grade so raw and slab checks stay separate", () => {
  assert.notEqual(recentCompKey(baseComp), recentCompKey({ ...baseComp, grade: "PSA_10" }));
});
