import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompResult, Grade, RawCondition } from "../domain/types.js";
import { PrismaCompResultRepo, PrismaLastKnownCompCache } from "./prismaCompResultRepo.js";

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
  displayImageUrl: string | null;
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
  displayImageUrl?: string;
  tcgApiId?: string;
};

type FakeCompResultData = {
  cardId: string;
  grade: Grade;
  condition?: RawCondition;
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
  confidence?: string;
  manualCheck?: boolean;
  reasons?: unknown;
  receipt?: unknown;
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
            displayImageUrl: data.displayImageUrl ?? null,
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
            displayImageUrl: create.displayImageUrl ?? null,
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
        async findFirst({
          where,
          orderBy: _orderBy,
        }: {
          where: { cardId: string; grade: Grade; condition: RawCondition | null };
          orderBy: { createdAt: "desc" };
        }) {
          return (
            [...compResults]
              .filter((row) =>
                row.cardId === where.cardId &&
                row.grade === where.grade &&
                (row.condition ?? null) === where.condition,
              )
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
          );
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
      displayImageUrl: null,
      tcgApiId: "sv3pt5-199",
    },
  ]);
  const repo = new PrismaCompResultRepo(db.client);

  const row = await repo.create(comp({ id: "card_existing", name: "Charizard ex" }));

  assert.equal(db.cards.length, 1);
  assert.equal(row.cardId, "card_existing");
  assert.equal(db.compResults[0]?.asOf.toISOString(), "2026-06-21T12:00:00.000Z");
});

test("PrismaCompResultRepo persists reconciliation evidence for the manual-check queue", async () => {
  const db = fakeDb();
  const repo = new PrismaCompResultRepo(db.client, null);
  const reconciliation = {
    headlinePence: 2778,
    confidence: "low" as const,
    manualCheck: true,
    reasons: ["source-disagreement"],
    chosenSource: "pt-smart" as const,
    trendPct: null,
  };
  const row = await repo.create(comp({ name: "Gengar" }), {
    reconciliation,
    receipt: {
      all: [{ source: "pokemon-price-tracker", sampleSize: 8 }],
      sourcesDisagree: true,
    },
  });

  assert.equal(row.manualCheck, true);
  assert.equal(row.confidence, "low");
  assert.deepEqual(db.compResults[0]?.reasons, ["source-disagreement"]);
  assert.deepEqual(db.compResults[0]?.receipt, {
    all: [{ source: "pokemon-price-tracker", sampleSize: 8 }],
    sourcesDisagree: true,
    reconciliation,
  });
});

test("PrismaLastKnownCompCache reads the latest stored comp for card and grade", async () => {
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
      displayImageUrl: null,
      tcgApiId: "sv3pt5-199",
    },
  ]);
  const repo = new PrismaCompResultRepo(db.client);
  await repo.create({ ...comp({ id: "card_existing", name: "Charizard ex" }), medianPence: 2400 });
  await repo.create({ ...comp({ id: "card_existing", name: "Charizard ex" }), medianPence: 3100 });
  db.compResults[1]!.createdAt = new Date("2026-06-21T12:06:00.000Z");

  const cache = new PrismaLastKnownCompCache(repo);
  const cached = await cache.get({ id: "card_existing", name: "Charizard ex" }, { grade: "RAW" });

  assert.equal(cached?.headline.medianPence, 3100);
  assert.equal(cached?.headline.card.tcgApiId, "sv3pt5-199");
  assert.equal(cached?.cachedAt, "2026-06-21T12:06:00.000Z");
});

test("PrismaLastKnownCompCache retains a manual reconciliation verdict", async () => {
  const db = fakeDb([
    {
      id: "card_existing",
      game: "POKEMON",
      language: "EN",
      name: "Rayquaza VMAX",
      setName: "Evolving Skies",
      setCode: "swsh7",
      number: "218/203",
      rarity: "Secret Rare",
      imageUrl: null,
      displayImageUrl: null,
      tcgApiId: "swsh7-218",
    },
  ]);
  const repo = new PrismaCompResultRepo(db.client);
  const reconciliation = {
    headlinePence: 103_981,
    confidence: "low" as const,
    manualCheck: true,
    reasons: ["high-value-without-traceable-uk-sales"],
    chosenSource: "poketrace" as const,
    trendPct: null,
  };
  await repo.create({
    ...comp({ id: "card_existing", name: "Rayquaza VMAX" }),
    medianPence: 103_981,
  }, { reconciliation });

  const cached = await new PrismaLastKnownCompCache(repo).get(
    { id: "card_existing", name: "Rayquaza VMAX" },
    { grade: "RAW" },
  );

  assert.deepEqual(cached?.reconciliation, reconciliation);
  assert.equal(cached?.reconciliation?.manualCheck, true);
});

test("PrismaLastKnownCompCache retains source disagreement independently of manual-check", async () => {
  const db = fakeDb([
    {
      id: "card_existing",
      game: "POKEMON",
      language: "EN",
      name: "Gengar",
      setName: "Lost Origin",
      setCode: "swsh11",
      number: "TG06/TG30",
      rarity: "Trainer Gallery Rare Holo",
      imageUrl: null,
      displayImageUrl: null,
      tcgApiId: "swsh11tg-TG06",
    },
  ]);
  const repo = new PrismaCompResultRepo(db.client);
  await repo.create(comp({ id: "card_existing", name: "Gengar" }), {
    reconciliation: {
      headlinePence: 2_778,
      confidence: "medium",
      manualCheck: false,
      reasons: [],
      trendPct: null,
    },
    receipt: { all: [], sourcesDisagree: true },
  });

  const cached = await new PrismaLastKnownCompCache(repo).get(
    { id: "card_existing", name: "Gengar" },
    { grade: "RAW" },
  );

  assert.equal(cached?.reconciliation?.manualCheck, false);
  assert.equal(cached?.sourcesDisagree, true);
});

test("PrismaLastKnownCompCache recovers legacy reconciliation columns when the receipt lacks the verdict", async () => {
  const db = fakeDb([
    {
      id: "card_existing",
      game: "POKEMON",
      language: "EN",
      name: "Gengar",
      setName: "Lost Origin",
      setCode: "swsh11",
      number: "TG06/TG30",
      rarity: "Trainer Gallery Rare Holo",
      imageUrl: null,
      displayImageUrl: null,
      tcgApiId: "swsh11tg-TG06",
    },
  ]);
  const repo = new PrismaCompResultRepo(db.client);
  await repo.create(comp({ id: "card_existing", name: "Gengar" }), {
    reconciliation: {
      headlinePence: 2_778,
      confidence: "low",
      manualCheck: true,
      reasons: ["source-disagreement"],
      trendPct: null,
    },
  });
  db.compResults[0]!.receipt = { all: [] };

  const cached = await new PrismaLastKnownCompCache(repo).get(
    { id: "card_existing", name: "Gengar" },
    { grade: "RAW" },
  );

  assert.deepEqual(cached?.reconciliation, {
    headlinePence: 2_778,
    confidence: "low",
    manualCheck: true,
    reasons: ["source-disagreement"],
    trendPct: null,
  });
});

test("Prisma comp persistence and warm cache isolate RAW condition buckets", async () => {
  const db = fakeDb([
    {
      id: "card_existing",
      game: "POKEMON",
      language: "EN",
      name: "Rayquaza VMAX",
      setName: "Evolving Skies",
      setCode: "swsh7",
      number: "218/203",
      rarity: "Secret Rare",
      imageUrl: null,
      displayImageUrl: null,
      tcgApiId: "swsh7-218",
    },
  ]);
  const repo = new PrismaCompResultRepo(db.client);
  const base = comp({ id: "card_existing", name: "Rayquaza VMAX" });
  await repo.create({ ...base, medianPence: 60_000 }, { condition: "NM" });
  await repo.create({ ...base, medianPence: 45_000 }, { condition: "LP" });
  db.compResults[1]!.createdAt = new Date("2026-06-21T12:06:00.000Z");

  const cache = new PrismaLastKnownCompCache(repo);
  const nm = await cache.get({ id: "card_existing", name: "Rayquaza VMAX" }, { grade: "RAW", condition: "NM" });
  const lp = await cache.get({ id: "card_existing", name: "Rayquaza VMAX" }, { grade: "RAW", condition: "LP" });
  const unscoped = await cache.get({ id: "card_existing", name: "Rayquaza VMAX" }, { grade: "RAW" });

  assert.equal(db.compResults[0]?.condition, "NM");
  assert.equal(db.compResults[1]?.condition, "LP");
  assert.equal(nm?.headline.medianPence, 60_000);
  assert.equal(lp?.headline.medianPence, 45_000);
  assert.equal(unscoped, null);
});

test("invalid provider timestamps persist as stale instead of becoming fresh now", async () => {
  const db = fakeDb();
  const repo = new PrismaCompResultRepo(db.client, null);

  await repo.create({ ...comp({ name: "Unknown age card" }), asOf: "unknown" });

  assert.equal(db.compResults[0]?.asOf.toISOString(), "1970-01-01T00:00:00.000Z");
});
