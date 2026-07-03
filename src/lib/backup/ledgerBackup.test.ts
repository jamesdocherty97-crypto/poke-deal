import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLedgerBackup,
  LEDGER_BACKUP_TABLES,
  restoreLedgerBackup,
  rowsToCsv,
  type BackupPrismaClient,
  type PlainRow,
} from "./ledgerBackup.js";

type DelegateStore = {
  rows: PlainRow[];
  createCalls: number;
  delegate: {
    findMany(args?: { orderBy?: { id: "asc" } }): Promise<PlainRow[]>;
    count(): Promise<number>;
    createMany(args: { data: PlainRow[] }): Promise<{ count: number }>;
    deleteMany(): Promise<{ count: number }>;
  };
};

const delegateByTable = {
  cards: "card",
  inventoryItems: "inventoryItem",
  cardPhotos: "cardPhoto",
  listings: "listing",
  sales: "sale",
  ebayOrderImports: "ebayOrderImport",
  expenses: "expense",
  dealSessions: "dealSession",
  dealSessionLines: "dealSessionLine",
  compResults: "compResult",
  priceSnapshots: "priceSnapshot",
  cronRuns: "cronRun",
  fxRates: "fxRate",
  watches: "watch",
  alerts: "alert",
  appAlerts: "appAlert",
} as const;

test("ledger backup exports every persisted table and round-trips into an empty database", async () => {
  const source = fakeBackupDb(seedRows());
  const backup = await createLedgerBackup(source.client, new Date("2026-07-03T10:00:00.000Z"));
  const parsedBackup = JSON.parse(JSON.stringify(backup));
  const target = fakeBackupDb();

  assert.deepEqual(backup.tableOrder, LEDGER_BACKUP_TABLES);
  for (const tableName of LEDGER_BACKUP_TABLES) {
    assert.equal(backup.tables[tableName].rowCount, 1, tableName);
  }
  assert.match(backup.notes.settings, /No Settings table exists/);
  assert.match(backup.notes.checkedComps, /compResults/);

  const report = await restoreLedgerBackup(parsedBackup, { db: target.client });
  assert.equal(report.force, false);

  const restored = await createLedgerBackup(target.client, new Date("2026-07-03T10:00:00.000Z"));
  assert.deepEqual(restored.tables, backup.tables);
});

test("ledger restore refuses a non-empty database unless force is set", async () => {
  const backup = await createLedgerBackup(fakeBackupDb(seedRows()).client);
  const target = fakeBackupDb({ cards: [{ id: "existing-card", name: "Already here" }] });

  await assert.rejects(
    () => restoreLedgerBackup(JSON.parse(JSON.stringify(backup)), { db: target.client }),
    /Refusing to restore into a non-empty database: cards/,
  );
});

test("ledger restore force wipes existing rows before restoring and verifies counts", async () => {
  const backup = await createLedgerBackup(fakeBackupDb(seedRows()).client);
  const target = fakeBackupDb({
    cards: [{ id: "existing-card", name: "Already here" }],
    alerts: [{ id: "old-alert", watchId: "old-watch", kind: "PRICE_DROP" }],
  });

  const report = await restoreLedgerBackup(JSON.parse(JSON.stringify(backup)), { db: target.client, force: true });
  const cardStore = target.stores.card;

  assert.equal(report.force, true);
  assert.ok(cardStore);
  assert.equal(cardStore.rows.some((row) => row.id === "existing-card"), false);
  assert.equal(cardStore.rows.length, 1);
});

test("ledger restore batches large tables", async () => {
  const cards = Array.from({ length: 1001 }, (_, index) => ({
    id: `card-${String(index).padStart(4, "0")}`,
    name: `Card ${index}`,
    setName: "Test Set",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
  }));
  const backup = await createLedgerBackup(fakeBackupDb({ cards }).client);
  const target = fakeBackupDb();

  await restoreLedgerBackup(JSON.parse(JSON.stringify(backup)), { db: target.client });

  assert.equal(target.stores.card?.rows.length, 1001);
  assert.equal(target.stores.card?.createCalls, 3);
});

test("rowsToCsv writes escaped generic table rows", () => {
  const csv = rowsToCsv([
    { id: "one", title: "Charizard, PSA 10", notes: "clean \"copy\"" },
  ]);

  assert.equal(csv, 'id,title,notes\none,"Charizard, PSA 10","clean ""copy"""\n');
});

function fakeBackupDb(seed: Partial<Record<keyof typeof delegateByTable, PlainRow[]>> = {}) {
  const stores = {} as Record<string, DelegateStore>;
  const client: Record<string, DelegateStore["delegate"]> = {};

  for (const [tableName, delegateName] of Object.entries(delegateByTable)) {
    const rows = [...(seed[tableName as keyof typeof delegateByTable] ?? [])];
    let store: DelegateStore;
    store = {
      rows,
      createCalls: 0,
      delegate: {
        async findMany() {
          return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(cloneRow);
        },
        async count() {
          return rows.length;
        },
        async createMany({ data }) {
          store.createCalls += 1;
          rows.push(...data.map(cloneRow));
          return { count: data.length };
        },
        async deleteMany() {
          const count = rows.length;
          rows.splice(0, rows.length);
          return { count };
        },
      },
    };
    stores[delegateName] = store;
    client[delegateName] = store.delegate;
  }

  return { client: client as BackupPrismaClient, stores };
}

function cloneRow(row: PlainRow): PlainRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? new Date(value) : value]),
  );
}

function seedRows(): Partial<Record<keyof typeof delegateByTable, PlainRow[]>> {
  return {
    cards: [
      {
        id: "card-1",
        game: "POKEMON",
        language: "EN",
        name: "Umbreon VMAX",
        setName: "Evolving Skies",
        setCode: "swsh7",
        number: "215/203",
        rarity: "Secret Rare",
        imageUrl: "https://example.test/umbreon.png",
        tcgApiId: "swsh7-215",
        tcgDexId: null,
        cardmarketId: null,
        createdAt: "2026-07-01T10:00:00.000Z",
        updatedAt: "2026-07-01T10:00:00.000Z",
      },
    ],
    inventoryItems: [
      {
        id: "item-1",
        cardId: "card-1",
        grade: "PSA_10",
        graderCert: "12345678",
        condition: null,
        quantity: 1,
        costBasis: 85000,
        acquiredFrom: "Card fair",
        acquiredAt: "2026-07-01T11:00:00.000Z",
        location: "Case A",
        status: "IN_STOCK",
        createdAt: "2026-07-01T11:00:00.000Z",
        updatedAt: "2026-07-01T11:00:00.000Z",
      },
    ],
    cardPhotos: [
      {
        id: "photo-1",
        inventoryItemId: "item-1",
        url: "https://example.test/front.jpg",
        role: "FRONT",
        origin: "REAL",
        width: 800,
        height: 1100,
        order: 0,
        createdAt: "2026-07-01T11:05:00.000Z",
      },
    ],
    listings: [
      {
        id: "listing-1",
        itemId: "item-1",
        channel: "EBAY",
        state: "DRAFT",
        title: "Umbreon VMAX PSA 10",
        description: "Clean slab",
        suggestedPrice: 105000,
        listPrice: 109995,
        externalRef: null,
        externalUrl: null,
        listedAt: null,
        endedAt: null,
        createdAt: "2026-07-01T11:10:00.000Z",
        updatedAt: "2026-07-01T11:10:00.000Z",
      },
    ],
    sales: [
      {
        id: "sale-1",
        itemId: "item-1",
        channel: "EBAY",
        salePrice: 120000,
        fees: 15600,
        postage: 350,
        soldAt: "2026-07-02T09:00:00.000Z",
        createdAt: "2026-07-02T09:00:00.000Z",
      },
    ],
    ebayOrderImports: [
      {
        id: "ebay-import-1",
        importKey: "ebay:order-1:line-1",
        orderId: "order-1",
        lineItemId: "line-1",
        sku: "pdos-item-1",
        ebayItemId: "1234567890",
        title: "Umbreon VMAX PSA 10",
        status: "MATCHED",
        reason: "Imported from eBay order.",
        itemId: "item-1",
        listingId: "listing-1",
        saleId: "sale-1",
        orderCreatedAt: "2026-07-02T08:59:00.000Z",
        paidAt: "2026-07-02T09:00:00.000Z",
        buyerPaidPence: 120000,
        postageChargedPence: 499,
        feesEstimatePence: 15390,
        payload: { fixture: true },
        createdAt: "2026-07-02T09:00:00.000Z",
        updatedAt: "2026-07-02T09:00:00.000Z",
      },
    ],
    expenses: [
      {
        id: "expense-1",
        category: "TABLE_FEE",
        description: "Card fair table",
        amount: 1500,
        spentAt: "2026-07-01T08:00:00.000Z",
        channel: "IN_PERSON",
        source: "Local fair",
        notes: "Sunday",
        createdAt: "2026-07-01T08:00:00.000Z",
        updatedAt: "2026-07-01T08:00:00.000Z",
      },
    ],
    dealSessions: [
      {
        id: "session-1",
        name: "Binder buy",
        status: "OPEN",
        createdAt: "2026-07-01T09:00:00.000Z",
        updatedAt: "2026-07-01T09:00:00.000Z",
        completedAt: null,
        abandonedAt: null,
        paidPence: null,
      },
    ],
    dealSessionLines: [
      {
        id: "line-1",
        sessionId: "session-1",
        cardId: "card-1",
        name: "Umbreon VMAX",
        setName: "Evolving Skies",
        setCode: "swsh7",
        number: "215/203",
        tcgApiId: "swsh7-215",
        tcgDexId: null,
        imageUrl: "https://example.test/umbreon.png",
        grade: "PSA_10",
        headlinePence: 105000,
        confidence: "HIGH",
        manualCheck: false,
        maxCashOfferPence: 73500,
        maxTradeOfferPence: 78750,
        dealerOfferPence: 70000,
        netProceedsPence: 90000,
        expectedProfitPence: 20000,
        sampleSize: 8,
        windowDays: 90,
        compSource: "pokemon-price-tracker",
        compAsOf: "2026-07-01T09:05:00.000Z",
        addedAt: "2026-07-01T09:05:00.000Z",
      },
    ],
    compResults: [
      {
        id: "comp-1",
        cardId: "card-1",
        grade: "PSA_10",
        source: "manual-check",
        currency: "GBP",
        medianPence: 105000,
        meanPence: 106000,
        lowPence: 99000,
        highPence: 115000,
        sampleSize: 8,
        windowDays: 90,
        trendPct: null,
        outliersRemoved: 1,
        asOf: "2026-07-01T09:05:00.000Z",
        createdAt: "2026-07-01T09:05:00.000Z",
      },
    ],
    priceSnapshots: [
      {
        id: "snapshot-1",
        cardId: "card-1",
        grade: "PSA_10",
        marketPence: 105000,
        takenAt: "2026-07-01T23:59:00.000Z",
      },
    ],
    cronRuns: [
      {
        id: "cron-1",
        job: "daily-portfolio-snapshot",
        runKey: "2026-07-02",
        status: "SUCCESS",
        startedAt: "2026-07-02T07:30:00.000Z",
        finishedAt: "2026-07-02T07:31:00.000Z",
        details: { written: 1 },
        error: null,
        createdAt: "2026-07-02T07:30:00.000Z",
      },
    ],
    fxRates: [
      {
        id: "fx-usd-20260702",
        quote: "USD",
        perGbp: 1.27,
        asOf: "2026-07-02T00:00:00.000Z",
        provider: "exchangeratesapi",
        fetchedAt: "2026-07-02T07:00:00.000Z",
        createdAt: "2026-07-02T07:00:00.000Z",
        updatedAt: "2026-07-02T07:00:00.000Z",
      },
    ],
    watches: [
      {
        id: "watch-1",
        cardId: "card-1",
        grade: "PSA_10",
        targetPence: 90000,
        active: true,
        createdAt: "2026-07-01T12:00:00.000Z",
      },
    ],
    alerts: [
      {
        id: "alert-1",
        watchId: "watch-1",
        kind: "PRICE_DROP",
        message: "Target hit",
        pence: 89000,
        firedAt: "2026-07-02T12:00:00.000Z",
        delivered: false,
      },
    ],
    appAlerts: [
      {
        id: "app-alert-1",
        kind: "PRICE_DROP",
        title: "Buy target hit",
        message: "Target hit",
        pence: 89000,
        href: "/?view=pnl",
        sourceKey: "watch:alert-1",
        delivered: false,
        readAt: null,
        createdAt: "2026-07-02T12:00:00.000Z",
      },
    ],
  };
}
