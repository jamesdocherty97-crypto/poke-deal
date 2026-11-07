import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { POST as dryRunPost } from "../../app/api/export/inventory/dry-run/route.js";
import { GET as exportInventory } from "../../app/api/export/inventory/route.js";
import { parseStockImportText } from "../dealer/stockImport.js";
import {
  INVENTORY_V1_COLUMNS,
  dryRunInventoryV1,
  encodeInventoryV1,
  inventoryItemsToCsv,
  inventoryV1Filename,
  toInventoryV1Row,
  validateInventoryV1,
  type InventoryExportItem,
  type InventoryV1Report,
  type InventoryV1Row,
  type InventoryWriteRepo,
} from "./inventoryV1.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const charizard = {
  id: "card_charizard",
  name: "Charizard",
  setName: "Base Set",
  number: "4/102",
  language: "JP",
  edition: "FIRST_EDITION",
  finish: "REVERSE_HOLO",
};

function syntheticItems(): InventoryExportItem[] {
  return [
    {
      id: "item_nm",
      cardId: "card_charizard",
      grade: "PSA_10",
      graderCert: "88442211",
      condition: "NM",
      quantity: 1,
      costBasis: 70000,
      acquiredFrom: "eBay",
      acquiredAt: new Date("2026-01-15T12:00:00.000Z"),
      location: "Slabs",
      status: "LISTED",
      card: charizard,
      listings: [
        { id: "listing_a", createdAt: new Date("2026-04-01T00:00:00.000Z") },
        { id: "listing_z", createdAt: new Date("2026-03-01T00:00:00.000Z") },
      ],
    },
    {
      id: "item_lp",
      cardId: "card_charizard",
      grade: "RAW",
      graderCert: null,
      condition: "LP",
      quantity: 2,
      costBasis: 1500,
      acquiredFrom: "Card fair",
      acquiredAt: new Date("2026-02-01T09:30:00.000Z"),
      location: "Binder",
      status: "IN_STOCK",
      card: charizard,
      listings: [],
    },
    {
      id: "item_formula",
      cardId: "card_formula",
      grade: "RAW",
      graderCert: "'8844",
      condition: "\rLP",
      quantity: 1,
      costBasis: 0,
      acquiredFrom: "Card fair",
      acquiredAt: new Date("2026-03-01T00:00:00.000Z"),
      location: "\tbin",
      status: "IN_STOCK",
      card: {
        id: "card_formula",
        name: '=HYPERLINK("x")',
        setName: "+set",
        number: "-5",
        language: "EN",
        edition: "@SHADOWLESS",
        finish: "HOLO",
      },
      listings: [],
    },
    {
      id: "item_utf",
      cardId: "card_utf",
      grade: "CGC_9_5",
      graderCert: null,
      condition: "NM",
      quantity: 1,
      costBasis: 2500,
      acquiredFrom: "booth\nrow 2",
      acquiredAt: new Date("2026-04-04T04:04:04.004Z"),
      location: 'say "mint"',
      status: "IN_STOCK",
      card: {
        id: "card_utf",
        name: "ポケモン é",
        setName: "Base, Set",
        number: "12/34",
        language: "JP",
        edition: "UNLIMITED",
        finish: "NORMAL",
      },
      listings: [],
    },
    {
      id: "item_007",
      cardId: "card_pikachu",
      grade: "ACE_10",
      graderCert: null,
      condition: "NM",
      quantity: 1,
      costBasis: 500,
      acquiredFrom: "friend's lot",
      acquiredAt: new Date("2026-05-05T05:05:05.005Z"),
      location: "Box",
      status: "LISTED",
      card: {
        id: "card_pikachu",
        name: "Pikachu",
        setName: "Promo",
        number: "007",
        language: "EN",
        edition: null,
        finish: null,
      },
      listings: [{ id: "listing_007", createdAt: new Date("2026-05-06T00:00:00.000Z") }],
    },
  ];
}

function exportBytes(items = syntheticItems()): Uint8Array {
  return new TextEncoder().encode(inventoryItemsToCsv(items));
}

function validated(items = syntheticItems()): InventoryV1Report {
  const report = validateInventoryV1(exportBytes(items));
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  return report;
}

function row(report: InventoryV1Report, itemId: string): InventoryV1Row {
  const found = report.rows.find((entry) => entry.item_id === itemId);
  assert.ok(found, itemId);
  return found;
}

function trackRepo(): { repo: InventoryWriteRepo; touches: string[] } {
  const touches: string[] = [];
  const repo = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      const name = String(prop);
      touches.push(name);
      return () => {
        touches.push(`${name}()`);
        return undefined;
      };
    },
  });
  return { repo, touches };
}

function expectRejected(bytes: Uint8Array, message: string, line?: number): InventoryV1Report {
  const { repo, touches } = trackRepo();
  const report = dryRunInventoryV1(bytes, repo);
  assert.equal(report.ok, false);
  assert.equal(report.rows.length, 0);
  assert.ok(report.errorCount >= 1);
  assert.equal(report.errorCount, report.errors.length);
  assert.ok(
    report.errors.some((error) => error.message.includes(message) && (line == null || error.line === line)),
    JSON.stringify(report.errors),
  );
  assert.deepEqual(touches, []);
  return report;
}

function withFirstRow(mutate: (entry: InventoryV1Row) => void): Uint8Array {
  const rows = syntheticItems().map(toInventoryV1Row);
  const source = rows[0];
  assert.ok(source);
  const first = { ...source };
  mutate(first);
  rows[0] = first;
  return new TextEncoder().encode(encodeInventoryV1(rows));
}

let prismaQueue: Promise<void> = Promise.resolve();

async function withPrisma<T>(prisma: unknown, run: () => Promise<T>): Promise<T> {
  const previousTurn = prismaQueue;
  let release: () => void = () => undefined;
  prismaQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previousTurn;
  const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
  const previous = globalDb.prisma;
  globalDb.prisma = prisma;
  try {
    return await run();
  } finally {
    globalDb.prisma = previous;
    release();
  }
}

test("T1 export includes all 5 synthetic items including 3 unlisted", async () => {
  const csv = inventoryItemsToCsv(syntheticItems());
  const report = validateInventoryV1(new TextEncoder().encode(csv));
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.rowCount, 5);
  assert.deepEqual(
    report.rows.map((entry) => entry.item_id).sort(),
    ["item_007", "item_formula", "item_lp", "item_nm", "item_utf"],
  );
  const unlisted = report.rows.filter((entry) => entry.inventory_status === "IN_STOCK" && entry.listing_count === "0");
  assert.deepEqual(unlisted.map((entry) => entry.item_id).sort(), ["item_formula", "item_lp", "item_utf"]);
  assert.ok(report.rows.every((entry) => entry.schema_version === "inventory-v1" && entry.currency === "GBP"));
  assert.equal(csv.split("\r\n").length, 7);
  assert.equal(csv.charCodeAt(0), '"'.charCodeAt(0));

  const writes: string[] = [];
  let query: unknown;
  const rejectWrite = (name: string) => () => {
    writes.push(name);
    throw new Error(`unexpected write ${name}`);
  };
  const db = {
    inventoryItem: {
      async findMany(args: unknown) {
        query = args;
        return syntheticItems();
      },
      create: rejectWrite("inventoryItem.create"),
      createMany: rejectWrite("inventoryItem.createMany"),
      update: rejectWrite("inventoryItem.update"),
      updateMany: rejectWrite("inventoryItem.updateMany"),
      upsert: rejectWrite("inventoryItem.upsert"),
      delete: rejectWrite("inventoryItem.delete"),
      deleteMany: rejectWrite("inventoryItem.deleteMany"),
    },
    listing: {
      create: rejectWrite("listing.create"),
      update: rejectWrite("listing.update"),
      delete: rejectWrite("listing.delete"),
    },
    $transaction: rejectWrite("$transaction"),
    $executeRaw: rejectWrite("$executeRaw"),
    $executeRawUnsafe: rejectWrite("$executeRawUnsafe"),
  };

  await withPrisma(db, async () => {
    const response = await exportInventory();
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.notDeepEqual(Array.from(bytes.subarray(0, 3)), [0xef, 0xbb, 0xbf]);
    assert.equal(bytes[0], 0x22);
    const body = new TextDecoder().decode(bytes);
    const exported = validateInventoryV1(bytes);
    assert.equal(exported.ok, true, JSON.stringify(exported.errors));
    assert.equal(exported.rowCount, 5);
    assert.equal(exported.rows.filter((entry) => entry.inventory_status === "IN_STOCK").length, 3);
    assert.equal(body.startsWith(`"${INVENTORY_V1_COLUMNS.join('","')}"\r\n`), true);
    assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename="${inventoryV1Filename()}"`,
    );
    assert.match(
      response.headers.get("content-disposition") ?? "",
      /filename="pokemon-dealer-inventory-v1-\d{4}-\d{2}-\d{2}\.csv"/,
    );
  });

  assert.deepEqual(writes, []);
  assert.deepEqual(query, {
    include: {
      card: true,
      listings: { select: { id: true, createdAt: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const routeSource = fs.readFileSync(new URL("../../app/api/export/inventory/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /findMany\(/);
  assert.doesNotMatch(routeSource, /where:/);
  assert.doesNotMatch(routeSource, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\(|\$transaction|\$executeRaw/);
});

test("T2 exports condition, cert, language, edition, finish, and grade verbatim", () => {
  const csv = inventoryItemsToCsv(syntheticItems());
  const report = validated();
  const twins = report.rows.filter((entry) => entry.card_id === "card_charizard");
  assert.equal(twins.length, 2);
  const nm = row(report, "item_nm");
  const lp = row(report, "item_lp");
  assert.equal(nm.condition, "NM");
  assert.equal(lp.condition, "LP");
  assert.equal(nm.grade, "PSA_10");
  assert.equal(lp.grade, "RAW");
  assert.equal(nm.grader_cert, "88442211");
  assert.equal(lp.grader_cert, "");
  for (const twin of twins) {
    assert.equal(twin.card_name, "Charizard");
    assert.equal(twin.set_name, "Base Set");
    assert.equal(twin.number, "4/102");
    assert.equal(twin.language, "JP");
    assert.equal(twin.edition, "FIRST_EDITION");
    assert.equal(twin.finish, "REVERSE_HOLO");
  }
  assert.equal(nm.inventory_status, "LISTED");
  assert.equal(lp.inventory_status, "IN_STOCK");
  assert.equal(nm.cost_basis_pence, "70000");
  assert.equal(lp.quantity, "2");
  assert.equal(nm.acquired_at, "2026-01-15T12:00:00.000Z");
  assert.match(csv, /"PSA_10"/);
  assert.match(csv, /"88442211"/);
  assert.match(csv, /"JP"/);
  assert.match(csv, /"FIRST_EDITION"/);
  assert.match(csv, /"REVERSE_HOLO"/);
  assert.match(csv, /,"NM",/);
  assert.match(csv, /,"LP",/);
  assert.doesNotMatch(csv, /700\.00/);
});

test("T3 multi-listing item exports listing_count 2 and both ids", () => {
  const csv = inventoryItemsToCsv(syntheticItems());
  const nm = row(validated(), "item_nm");
  assert.equal(nm.listing_count, "2");
  assert.equal(nm.listing_ids, "listing_z;listing_a");
  assert.match(csv, /"2","listing_z;listing_a"/);
  assert.doesNotMatch(csv, /listing_a;listing_z/);

  const tied = toInventoryV1Row({
    ...syntheticItems()[0]!,
    listings: [
      { id: "listing_b", createdAt: new Date("2026-03-01T00:00:00.000Z") },
      { id: "listing_a", createdAt: new Date("2026-03-01T00:00:00.000Z") },
    ],
  });
  assert.equal(tied.listing_count, "2");
  assert.equal(tied.listing_ids, "listing_a;listing_b");
});

test("T4 formula cells are prefixed and decode to the original text", () => {
  const csv = inventoryItemsToCsv(syntheticItems());
  const formula = row(validated(), "item_formula");
  assert.equal(formula.card_name, '=HYPERLINK("x")');
  assert.equal(formula.set_name, "+set");
  assert.equal(formula.number, "-5");
  assert.equal(formula.edition, "@SHADOWLESS");
  assert.equal(formula.location, "\tbin");
  assert.equal(formula.condition, "\rLP");
  assert.equal(formula.grader_cert, "'8844");
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"'\+set"/);
  assert.match(csv, /"'-5"/);
  assert.match(csv, /"'@SHADOWLESS"/);
  assert.match(csv, /"'\tbin"/);
  assert.match(csv, /"'\rLP"/);
  assert.match(csv, /"''8844"/);
  assert.match(csv, /,"NM",/);
  assert.doesNotMatch(csv, /,"'NM",/);
});

test("T5 UTF-8, comma, quote, and newline round-trip without a BOM", () => {
  const bytes = exportBytes();
  assert.notDeepEqual(Array.from(bytes.subarray(0, 3)), [0xef, 0xbb, 0xbf]);
  assert.ok(Buffer.from(bytes).includes(Buffer.from("ポケモン é", "utf8")));
  const csv = new TextDecoder().decode(bytes);
  const utf = row(validateInventoryV1(bytes), "item_utf");
  assert.equal(utf.card_name, "ポケモン é");
  assert.equal(utf.set_name, "Base, Set");
  assert.equal(utf.location, 'say "mint"');
  assert.equal(utf.acquired_from, "booth\nrow 2");
  assert.match(csv, /"ポケモン é"/);
  assert.match(csv, /"Base, Set"/);
  assert.match(csv, /"say ""mint"""/);
  assert.match(csv, /"booth\nrow 2"/);
  const parts = csv.split("\r\n");
  assert.equal(parts.at(-1), "");
  assert.equal(parts.length, 7);
  assert.ok(parts.some((part) => part.includes("\n")));
});

test("T6 validateInventoryV1 round-trips source rows and bytes", () => {
  const items = syntheticItems();
  const source = items.map(toInventoryV1Row);
  const csv = inventoryItemsToCsv(items);
  const bytes = new TextEncoder().encode(csv);
  const { repo, touches } = trackRepo();
  const report = dryRunInventoryV1(bytes, repo);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.rows, source);
  assert.equal(encodeInventoryV1(report.rows), csv);
  assert.deepEqual(new TextEncoder().encode(encodeInventoryV1(report.rows)), bytes);
  assert.deepEqual(touches, []);

  const empty = encodeInventoryV1([]);
  const emptyReport = validateInventoryV1(new TextEncoder().encode(empty));
  assert.equal(emptyReport.ok, true);
  assert.equal(emptyReport.rowCount, 0);
  assert.equal(encodeInventoryV1(emptyReport.rows), empty);

  const moduleSource = fs.readFileSync(new URL("./inventoryV1.ts", import.meta.url), "utf8");
  assert.doesNotMatch(moduleSource, /prisma|next\/server|stockImport/);
});

test("T7 rejected files report errors and perform no writes", () => {
  const rows = syntheticItems().map(toInventoryV1Row);
  expectRejected(withFirstRow((entry) => {
    entry.currency = "EUR";
  }), "currency must be GBP", 2);
  expectRejected(
    new TextEncoder().encode(encodeInventoryV1(rows).replace('"item_id"', '"sku"')),
    "header must match inventory-v1 columns exactly",
    1,
  );
  expectRejected(withFirstRow((entry) => {
    entry.listing_count = "9";
  }), "listing_count does not match listing_ids", 2);
  expectRejected(Uint8Array.of(0xff, 0xfe, 0xfd), "file is not valid UTF-8", 1);
  expectRejected(
    new TextEncoder().encode(encodeInventoryV1([...rows, { ...rows[0]! }])),
    "duplicate item_id",
    rows.length + 2,
  );
  expectRejected(withFirstRow((entry) => {
    entry.schema_version = "inventory-v0";
  }), "schema_version must be inventory-v1", 2);
  expectRejected(withFirstRow((entry) => {
    entry.quantity = "0";
  }), "quantity must be an integer >= 1", 2);
  expectRejected(withFirstRow((entry) => {
    entry.quantity = "1.5";
  }), "quantity must be an integer >= 1", 2);
  expectRejected(withFirstRow((entry) => {
    entry.cost_basis_pence = "-1";
  }), "cost_basis_pence must be an integer >= 0", 2);
  expectRejected(withFirstRow((entry) => {
    entry.cost_basis_pence = "10.0";
  }), "cost_basis_pence must be an integer >= 0", 2);
  expectRejected(withFirstRow((entry) => {
    entry.listing_count = "2.0";
  }), "listing_count must be an integer >= 0", 2);

  const { repo, touches } = trackRepo();
  const combined = dryRunInventoryV1(withFirstRow((entry) => {
    entry.currency = "EUR";
    entry.quantity = "0";
    entry.cost_basis_pence = "-5";
  }), repo);
  assert.equal(combined.ok, false);
  assert.ok(combined.errorCount >= 3);
  assert.equal(combined.rows.length, 0);
  assert.deepEqual(touches, []);
});

test("T8 dry-run route performs zero writes", async () => {
  const { repo, touches } = trackRepo();
  const valid = exportBytes();
  const direct = dryRunInventoryV1(valid, repo);
  assert.equal(direct.ok, true, JSON.stringify(direct.errors));
  assert.deepEqual(touches, []);

  const dryRunSource = fs.readFileSync(new URL("../../app/api/export/inventory/dry-run/route.ts", import.meta.url), "utf8");
  assert.match(dryRunSource, /dryRunInventoryV1\(body\.value, NO_DATABASE\)/);
  assert.doesNotMatch(dryRunSource, /getPrisma|@prisma|prisma/);
  assert.doesNotMatch(
    dryRunSource,
    /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\(|\$transaction|\$executeRaw|findMany\(/,
  );

  await withPrisma(repo, async () => {
    const accepted = await dryRunPost(new Request("http://localhost/api/export/inventory/dry-run", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: new TextDecoder().decode(valid),
    }));
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json() as InventoryV1Report & { writes: number };
    assert.equal(acceptedBody.ok, true);
    assert.equal(acceptedBody.rowCount, 5);
    assert.equal(acceptedBody.errorCount, 0);
    assert.equal(acceptedBody.writes, 0);
    assert.equal(accepted.headers.get("cache-control"), "no-store");

    const rejected = await dryRunPost(new Request("http://localhost/api/export/inventory/dry-run", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new TextDecoder().decode(withFirstRow((entry) => {
        entry.currency = "EUR";
      })),
    }));
    assert.equal(rejected.status, 200);
    const rejectedBody = await rejected.json() as InventoryV1Report & { writes: number };
    assert.equal(rejectedBody.ok, false);
    assert.equal(rejectedBody.writes, 0);
    assert.ok(rejectedBody.errors.some((error) => error.message.includes("currency must be GBP")));
  });
  assert.deepEqual(touches, []);
});

test("T9 legacy stockImport tests remain the stock import contract", () => {
  const parsed = parseStockImportText(`card,set,number,grade,cost,qty,source,location,condition,cert,channel,list price,state
Gengar,Lost Origin Trainer Gallery,TG06/TG30,RAW,10.00,2,Card fair,Binder,NM,,Vinted,25.00,active
Pikachu ex,Surging Sparks,238/191,PSA 10,200,1,eBay,Slabs,,12345678,eBay,240,draft`);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.totalQuantity, 3);
  assert.equal(parsed.rows[1]?.graderCert, "12345678");

  const stockImportSource = fs.readFileSync(path.join(repoRoot, "src/lib/dealer/stockImport.ts"), "utf8");
  const stockImportTest = fs.readFileSync(path.join(repoRoot, "src/lib/dealer/stockImport.test.ts"), "utf8");
  assert.doesNotMatch(stockImportSource, /inventoryV1|validateInventoryV1/);
  assert.match(stockImportTest, /parseStockImportText parses headered stock CSV with listing prices/);
  assert.doesNotMatch(stockImportTest, /inventoryV1|validateInventoryV1/);

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "src/lib/dealer/stockImport.test.ts"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("T10 collector number 007 stays text", () => {
  const csv = inventoryItemsToCsv(syntheticItems());
  const promo = row(validated(), "item_007");
  assert.equal(promo.number, "007");
  assert.notEqual(promo.number, "7");
  assert.equal(promo.edition, "");
  assert.equal(promo.finish, "");
  assert.equal(promo.acquired_from, "friend's lot");
  assert.match(csv, /"007","EN","","","ACE_10"/);
  assert.match(csv, /"friend's lot"/);
  assert.doesNotMatch(csv, /"'007"/);
  assert.doesNotMatch(csv, /,007,/);
});
