import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompResult } from "../domain/types.js";
import { PrismaCompResultRepo } from "./prismaCompResultRepo.js";

type FakeCard = {
  id: string;
  game: "POKEMON" | "SOCCER";
  language: "EN" | "JP";
  name: string;
  setName: string;
  setCode: string | null;
  number: string | null;
  rarity: string | null;
  imageUrl: string | null;
  tcgApiId: string | null;
};

type FakeCardData = {
  game: "POKEMON" | "SOCCER";
  language: "EN" | "JP";
  name: string;
  setName: string;
  setCode?: string;
  number?: string;
  rarity?: string;
  imageUrl?: string;
  tcgApiId?: string;
};

type FakeCompResultData = {
  cardId: string;
  grade: "RAW" | "PSA_10";
  source: string;
  currency: "GBP";
  medianPence: number;
  meanPence: number;
  lowPence: number;
  highPence: number;
  sampleSize: number;
  windowDays: number;
  trendPct: number | null;
  outliersRemoved: number;
  asOf: Date;
};

function comp(card: CompResult["card"]): CompResult {
  return {
    source: "pokemon-price-tracker",
    card,
    grade: "RAW",
    currency: "GBP",
    medianPence: 2778,
    meanPence: 2795,
    lowPence: 2650,
    highPence: 3000,
    sampleSize: 8,
    windowDays: 90,
    trendPct: null,
    outliersRemoved: 2,
    asOf: "2026-06-21T12:00:00.000Z",
  };
}

function fakeDb(seedCards: FakeCard[] = []) {
  const cards = [...seedCards];
  const compResults: Array<FakeCompResultData & { id: string; createdAt: Date }> = [];
  let cardSeq = cards.length;
  let compSeq = 0;

  return {
    cards,
    compResults,
    client: {
      card: {
        async findUnique({ where }: { where: { id?: string; tcgApiId?: string } }) {
          return (
            cards.find((card) =>
              where.id ? card.id === where.id : card.tcgApiId === where.tcgApiId,
            ) ?? null
          );
        },
        async findFirst({ where }: { where: Partial<FakeCard> }) {
          return (
            cards.find((card) =>
              Object.entries(where).every(([key, value]) => card[key as keyof FakeCard] === value),
            ) ?? null
          );
        },
        async create({ data }: { data: FakeCardData }) {
          const card = {
            id: `card_${++cardSeq}`,
            ...data,
            setCode: data.setCode ?? null,
            number: data.number ?? null,
            rarity: data.rarity ?? null,
            imageUrl: data.imageUrl ?? null,
            tcgApiId: data.tcgApiId ?? null,
          };
          cards.push(card);
          return card;
        },
        async upsert({
          where,
          create,
          update,
        }: {
          where: { tcgApiId: string };
          create: FakeCardData;
          update: Partial<FakeCardData>;
        }) {
          const existing = cards.find((card) => card.tcgApiId === where.tcgApiId);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const card = {
            id: `card_${++cardSeq}`,
            ...create,
            setCode: create.setCode ?? null,
            number: create.number ?? null,
            rarity: create.rarity ?? null,
            imageUrl: create.imageUrl ?? null,
            tcgApiId: create.tcgApiId ?? null,
          };
          cards.push(card);
          return card;
        },
      },
      compResult: {
        async create({ data }: { data: FakeCompResultData }) {
          const row = {
            id: `comp_${++compSeq}`,
            createdAt: new Date("2026-06-21T12:05:00.000Z"),
            ...data,
          };
          compResults.push(row);
          return row;
        },
      },
    },
  };
}

test("PrismaCompResultRepo persists headline comp and resolved card", async () => {
  const db = fakeDb();
  const repo = new PrismaCompResultRepo(db.client, {
    name: "fake-catalog",
    live: true,
    async resolve() {
      return {
        game: "POKEMON",
        language: "EN",
        name: "Charizard ex",
        setName: "Scarlet & Violet 151",
        setCode: "sv3pt5",
        number: "199/165",
        rarity: "Special Illustration Rare",
        imageUrl: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
        tcgApiId: "sv3pt5-199",
      };
    },
  });

  const row = await repo.create(comp({ name: "Charizard ex", setName: "151", number: "199/165" }));

  assert.equal(row.id, "comp_1");
  assert.equal(row.cardId, "card_1");
  assert.equal(db.cards[0]?.tcgApiId, "sv3pt5-199");
  assert.equal(db.compResults[0]?.medianPence, 2778);
  assert.equal(db.compResults[0]?.outliersRemoved, 2);
});

test("PrismaCompResultRepo persists against an existing card id", async () => {
  const db = fakeDb([
    {
      id: "card_existing",
      game: "POKEMON",
      language: "EN",
      name: "Charizard ex",
      setName: "Scarlet & Violet 151",
      setCode: "sv3pt5",
      number: "199/165",
      rarity: "Special Illustration Rare",
      imageUrl: null,
      tcgApiId: "sv3pt5-199",
    },
  ]);
  const repo = new PrismaCompResultRepo(db.client);

  const row = await repo.create(comp({ id: "card_existing", name: "Charizard ex" }));

  assert.equal(db.cards.length, 1);
  assert.equal(row.cardId, "card_existing");
  assert.equal(db.compResults[0]?.asOf.toISOString(), "2026-06-21T12:00:00.000Z");
});
