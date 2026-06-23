import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaInventoryRepo } from "./prismaInventoryRepo.js";

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

type FakeItem = {
  id: string;
  cardId: string;
  grade: "RAW" | "PSA_10";
  quantity: number;
  costBasis: number;
  acquiredFrom: string | null;
  location: string | null;
  condition: string | null;
  graderCert: string | null;
  status: "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
  createdAt: Date;
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

type FakeItemData = {
  cardId: string;
  grade: "RAW" | "PSA_10";
  quantity: number;
  costBasis: number;
  acquiredFrom?: string;
  location?: string;
  condition?: string;
  graderCert?: string;
  status: "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
};

function fakeDb(seedCards: FakeCard[] = []) {
  const cards = [...seedCards];
  const items: FakeItem[] = [];
  let cardSeq = cards.length;
  let itemSeq = 0;

  const withCard = (item: FakeItem) => ({
    ...item,
    card: cards.find((card) => card.id === item.cardId)!,
  });

  return {
    cards,
    items,
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
      inventoryItem: {
        async create({
          data,
        }: {
          data: FakeItemData;
          include: { card: true };
        }) {
          const item: FakeItem = {
            id: `inv_${++itemSeq}`,
            createdAt: new Date("2026-06-21T12:00:00.000Z"),
            ...data,
            acquiredFrom: data.acquiredFrom ?? null,
            location: data.location ?? null,
            condition: data.condition ?? null,
            graderCert: data.graderCert ?? null,
          };
          items.push(item);
          return withCard(item);
        },
        async findMany() {
          return [...items]
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map(withCard);
        },
      },
    },
  };
}

test("PrismaInventoryRepo creates a card and maps inventory fields", async () => {
  const db = fakeDb();
  const repo = new PrismaInventoryRepo(db.client);

  const item = await repo.create({
    card: { name: "Charizard ex", setName: "151", number: "199/165" },
    grade: "RAW",
    quantity: 2,
    costBasisPence: 1800,
    acquiredFrom: "Card fair",
    location: "Box A",
    condition: "NM",
    graderCert: "12345678",
    status: "IN_STOCK",
  });

  assert.equal(db.cards.length, 1);
  assert.equal(item.card.id, "card_1");
  assert.equal(item.card.setName, "151");
  assert.equal(item.costBasisPence, 1800);
  assert.equal(item.condition, "NM");
  assert.equal(item.graderCert, "12345678");
  assert.equal(item.createdAt, "2026-06-21T12:00:00.000Z");
});

test("PrismaInventoryRepo reuses tcgApiId cards", async () => {
  const db = fakeDb([
    {
      id: "card_existing",
      game: "POKEMON",
      language: "EN",
      name: "Old name",
      setName: "151",
      setCode: null,
      number: "199/165",
      rarity: null,
      imageUrl: null,
      tcgApiId: "sv3pt5-199",
    },
  ]);
  const repo = new PrismaInventoryRepo(db.client);

  const item = await repo.create({
    card: {
      name: "Charizard ex",
      setName: "151",
      number: "199/165",
      tcgApiId: "sv3pt5-199",
    },
    grade: "PSA_10",
    quantity: 1,
    costBasisPence: 12000,
    status: "IN_STOCK",
  });

  assert.equal(db.cards.length, 1);
  assert.equal(item.card.id, "card_existing");
  assert.equal(item.card.name, "Charizard ex");
});

test("PrismaInventoryRepo caches catalog-resolved card details", async () => {
  const db = fakeDb();
  const repo = new PrismaInventoryRepo(db.client, {
    name: "fake-catalog",
    live: true,
    async resolve(card) {
      assert.equal(card.name, "Charizard ex");
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

  const item = await repo.create({
    card: { name: "Charizard ex", setName: "151", number: "199/165" },
    grade: "RAW",
    quantity: 1,
    costBasisPence: 1800,
    status: "IN_STOCK",
  });

  assert.equal(db.cards.length, 1);
  assert.equal(db.cards[0]?.tcgApiId, "sv3pt5-199");
  assert.equal(db.cards[0]?.setName, "Scarlet & Violet 151");
  assert.equal(db.cards[0]?.setCode, "sv3pt5");
  assert.equal(db.cards[0]?.imageUrl, "https://images.pokemontcg.io/sv3pt5/199_hires.png");
  assert.equal(item.card.tcgApiId, "sv3pt5-199");
});

test("PrismaInventoryRepo lists persisted inventory records", async () => {
  const db = fakeDb();
  const repo = new PrismaInventoryRepo(db.client);

  await repo.create({
    card: { name: "Blastoise ex", setName: "151", number: "200/165" },
    grade: "RAW",
    quantity: 1,
    costBasisPence: 1200,
    status: "IN_STOCK",
  });

  const items = await repo.list();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.card.name, "Blastoise ex");
  assert.equal(items[0]?.status, "IN_STOCK");
});
