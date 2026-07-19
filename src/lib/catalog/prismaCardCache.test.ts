import assert from "node:assert/strict";
import test from "node:test";

import { PrismaCardCache, type PrismaCard } from "./prismaCardCache.js";

const legacy = card("legacy", "218");
const printed = card("printed", "218/203");

test("card cache deterministically prefers the printed total over a legacy numerator-only row", async () => {
  const seen: unknown[] = [];
  const cache = new PrismaCardCache({
    card: {
      async findUnique() {
        return null;
      },
      async findFirst({ where }) {
        seen.push(where);
        const serialized = JSON.stringify(where);
        if (serialized.includes('"startsWith":"218/"')) return printed;
        if (serialized.includes('"number":"218"')) return legacy;
        return null;
      },
      async create() {
        throw new Error("a matching printed card should be reused");
      },
      async upsert() {
        throw new Error("provider upsert is not expected");
      },
    },
  }, null);

  const resolved = await cache.resolve({
    name: "Rayquaza VMAX",
    setName: "Evolving Skies",
    number: "218",
    game: "POKEMON",
    language: "EN",
  });

  assert.equal(resolved.id, "printed");
  assert.equal(resolved.number, "218/203");
  assert.equal(seen.some((where) => JSON.stringify(where).includes('"number":"218"')), false);
});

test("provider id lookup wins before textual identity fallback", async () => {
  let textLookupCount = 0;
  const provider = { ...printed, id: "provider", tcgDexId: "swsh7-218" };
  const cache = new PrismaCardCache({
    card: {
      async findUnique({ where }) {
        return where.tcgDexId === "swsh7-218" ? provider : null;
      },
      async findFirst() {
        textLookupCount += 1;
        return legacy;
      },
      async create() {
        throw new Error("provider card should be reused");
      },
      async upsert() {
        throw new Error("provider card should be reused from cache");
      },
    },
  }, null);

  const resolved = await cache.resolve({
    name: "Rayquaza VMAX",
    setName: "Evolving Skies",
    number: "218",
    tcgDexId: "swsh7-218",
    game: "POKEMON",
    language: "EN",
  });

  assert.equal(resolved.id, "provider");
  assert.equal(textLookupCount, 0);
});

function card(id: string, number: string): PrismaCard {
  return {
    id,
    game: "POKEMON",
    language: "EN",
    name: "Rayquaza VMAX",
    setName: "Evolving Skies",
    setCode: "swsh7",
    number,
    rarity: "Secret Rare",
    imageUrl: null,
    displayImageUrl: null,
    tcgApiId: null,
    tcgDexId: null,
    cardmarketId: null,
    edition: null,
    finish: null,
  };
}
