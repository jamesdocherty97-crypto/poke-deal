import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPrisma } from "../db/prisma.js";

export const LEDGER_BACKUP_SCHEMA_VERSION = 1;

export type BackupTableName =
  | "cards"
  | "inventoryItems"
  | "cardPhotos"
  | "listings"
  | "sales"
  | "ebayOrderImports"
  | "expenses"
  | "dealSessions"
  | "dealSessionLines"
  | "compResults"
  | "priceSnapshots"
  | "cronRuns"
  | "fxRates"
  | "watches"
  | "alerts"
  | "appAlerts";

type BackupDelegate = {
  findMany(args?: { orderBy?: { id: "asc" } }): Promise<PlainRow[]>;
  count(): Promise<number>;
  createMany(args: { data: PlainRow[] }): Promise<{ count: number }>;
  deleteMany(): Promise<{ count: number }>;
};

export type BackupPrismaClient = Record<string, BackupDelegate>;

export type PlainRow = Record<string, unknown>;

export type LedgerBackupTable = {
  rowCount: number;
  rows: PlainRow[];
};

export type LedgerBackupBundle = {
  app: "poke-deal";
  schemaVersion: typeof LEDGER_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  tableOrder: BackupTableName[];
  tables: Record<BackupTableName, LedgerBackupTable>;
  notes: {
    costs: string;
    checkedComps: string;
    settings: string;
  };
};

export type LedgerRestoreReport = {
  restoredAt: string;
  force: boolean;
  tables: Array<{ name: BackupTableName; expected: number; actual: number }>;
};

export type WrittenLedgerBackup = {
  stamp: string;
  directory: string;
  bundlePath: string;
  csvPaths: Record<BackupTableName, string>;
};

type TableDefinition = {
  name: BackupTableName;
  delegate: keyof BackupPrismaClient;
  dateFields: readonly string[];
};

const TABLES: readonly TableDefinition[] = [
  { name: "cards", delegate: "card", dateFields: ["createdAt", "updatedAt"] },
  {
    name: "inventoryItems",
    delegate: "inventoryItem",
    dateFields: ["acquiredAt", "createdAt", "updatedAt"],
  },
  { name: "cardPhotos", delegate: "cardPhoto", dateFields: ["createdAt"] },
  { name: "listings", delegate: "listing", dateFields: ["listedAt", "endedAt", "createdAt", "updatedAt"] },
  { name: "sales", delegate: "sale", dateFields: ["soldAt", "createdAt"] },
  {
    name: "ebayOrderImports",
    delegate: "ebayOrderImport",
    dateFields: ["orderCreatedAt", "paidAt", "createdAt", "updatedAt"],
  },
  { name: "expenses", delegate: "expense", dateFields: ["spentAt", "createdAt", "updatedAt"] },
  {
    name: "dealSessions",
    delegate: "dealSession",
    dateFields: ["createdAt", "updatedAt", "completedAt", "abandonedAt"],
  },
  { name: "dealSessionLines", delegate: "dealSessionLine", dateFields: ["addedAt", "compAsOf"] },
  { name: "compResults", delegate: "compResult", dateFields: ["asOf", "createdAt"] },
  { name: "priceSnapshots", delegate: "priceSnapshot", dateFields: ["takenAt"] },
  { name: "cronRuns", delegate: "cronRun", dateFields: ["startedAt", "finishedAt", "createdAt"] },
  { name: "fxRates", delegate: "fxRate", dateFields: ["asOf", "fetchedAt", "createdAt", "updatedAt"] },
  { name: "watches", delegate: "watch", dateFields: ["createdAt"] },
  { name: "alerts", delegate: "alert", dateFields: ["firedAt"] },
  { name: "appAlerts", delegate: "appAlert", dateFields: ["readAt", "createdAt"] },
];

export const LEDGER_BACKUP_TABLES = TABLES.map((table) => table.name);

const RESTORE_ORDER: readonly BackupTableName[] = [
  "cards",
  "expenses",
  "dealSessions",
  "inventoryItems",
  "dealSessionLines",
  "cardPhotos",
  "listings",
  "sales",
  "ebayOrderImports",
  "compResults",
  "priceSnapshots",
  "cronRuns",
  "fxRates",
  "watches",
  "alerts",
  "appAlerts",
];

const DELETE_ORDER = [...RESTORE_ORDER].reverse();
const RESTORE_BATCH_SIZE = 500;

export async function createLedgerBackup(
  db: BackupPrismaClient = getPrisma() as unknown as BackupPrismaClient,
  now = new Date(),
): Promise<LedgerBackupBundle> {
  const tables = {} as Record<BackupTableName, LedgerBackupTable>;

  for (const definition of TABLES) {
    const rows = await delegateFor(db, definition).findMany({ orderBy: { id: "asc" } });
    tables[definition.name] = {
      rowCount: rows.length,
      rows: normalizeRows(rows),
    };
  }

  return {
    app: "poke-deal",
    schemaVersion: LEDGER_BACKUP_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    tableOrder: [...LEDGER_BACKUP_TABLES],
    tables,
    notes: {
      costs: "Operating costs are stored in the expenses table.",
      checkedComps: "Manual checked comps are stored in compResults rows, usually with source manual-check.",
      settings: "No Settings table exists in the current schema; app settings are code defaults or device-local UI state.",
    },
  };
}

export async function writeLedgerBackupFiles(
  bundle: LedgerBackupBundle,
  outputRoot = path.join(process.cwd(), "output", "backups"),
): Promise<WrittenLedgerBackup> {
  const stamp = backupStamp(bundle.createdAt);
  const directory = path.join(outputRoot, stamp);
  await mkdir(directory, { recursive: true });

  const bundlePath = path.join(directory, `poke-deal-backup-${stamp}.json`);
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  const csvPaths = {} as Record<BackupTableName, string>;
  for (const tableName of LEDGER_BACKUP_TABLES) {
    const csvPath = path.join(directory, `${tableName}.csv`);
    await writeFile(csvPath, rowsToCsv(bundle.tables[tableName].rows), "utf8");
    csvPaths[tableName] = csvPath;
  }

  return { stamp, directory, bundlePath, csvPaths };
}

export async function loadLedgerBackupBundle(fileOrDirectory: string): Promise<LedgerBackupBundle> {
  const bundlePath = await resolveBundlePath(fileOrDirectory);
  const text = await readFile(bundlePath, "utf8");
  const bundle = JSON.parse(text) as LedgerBackupBundle;
  validateBundle(bundle);
  return bundle;
}

export async function restoreLedgerBackup(
  bundle: LedgerBackupBundle,
  options: { db?: BackupPrismaClient; force?: boolean } = {},
): Promise<LedgerRestoreReport> {
  validateBundle(bundle);
  const db = options.db ?? (getPrisma() as unknown as BackupPrismaClient);
  const force = Boolean(options.force);
  const nonEmpty = await nonEmptyTables(db);

  if (nonEmpty.length > 0 && !force) {
    throw new Error(`Refusing to restore into a non-empty database: ${nonEmpty.join(", ")}. Re-run with --force to wipe first.`);
  }

  if (nonEmpty.length > 0 && force) {
    for (const tableName of DELETE_ORDER) {
      await delegateFor(db, tableDefinition(tableName)).deleteMany();
    }
  }

  for (const tableName of RESTORE_ORDER) {
    const definition = tableDefinition(tableName);
    const rows = bundle.tables[tableName]?.rows ?? [];
    if (rows.length === 0) continue;
    const delegate = delegateFor(db, definition);
    for (let index = 0; index < rows.length; index += RESTORE_BATCH_SIZE) {
      const batch = rows.slice(index, index + RESTORE_BATCH_SIZE);
      await delegate.createMany({ data: batch.map((row) => hydrateRow(row, definition.dateFields)) });
    }
  }

  const reportTables: LedgerRestoreReport["tables"] = [];
  for (const tableName of RESTORE_ORDER) {
    const expected = bundle.tables[tableName]?.rowCount ?? 0;
    const actual = await delegateFor(db, tableDefinition(tableName)).count();
    reportTables.push({ name: tableName, expected, actual });
    if (actual !== expected) {
      throw new Error(`Restore verification failed for ${tableName}: expected ${expected}, found ${actual}.`);
    }
  }

  return { restoredAt: new Date().toISOString(), force, tables: reportTables };
}

export function rowsToCsv(rows: PlainRow[]): string {
  if (rows.length === 0) return "";
  const columns = Array.from(rows.reduce<Set<string>>((seen, row) => {
    for (const key of Object.keys(row)) seen.add(key);
    return seen;
  }, new Set()));
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(formatCsvValue(row[column]))).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function backupStamp(isoDate: string): string {
  return isoDate.replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "").replace("T", "-");
}

function normalizeRows(rows: PlainRow[]): PlainRow[] {
  return rows.map((row) => {
    const normalized: PlainRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = value instanceof Date ? value.toISOString() : value;
    }
    return normalized;
  });
}

function hydrateRow(row: PlainRow, dateFields: readonly string[]): PlainRow {
  const hydrated: PlainRow = { ...row };
  for (const field of dateFields) {
    if (typeof hydrated[field] === "string") hydrated[field] = new Date(hydrated[field] as string);
  }
  return hydrated;
}

function delegateFor(db: BackupPrismaClient, definition: TableDefinition): BackupDelegate {
  const delegate = db[definition.delegate];
  if (!delegate) throw new Error(`Missing Prisma delegate for ${definition.name}.`);
  return delegate;
}

function tableDefinition(tableName: BackupTableName): TableDefinition {
  const definition = TABLES.find((table) => table.name === tableName);
  if (!definition) throw new Error(`Unknown backup table ${tableName}.`);
  return definition;
}

async function nonEmptyTables(db: BackupPrismaClient): Promise<BackupTableName[]> {
  const names: BackupTableName[] = [];
  for (const definition of TABLES) {
    if ((await delegateFor(db, definition).count()) > 0) names.push(definition.name);
  }
  return names;
}

function validateBundle(bundle: LedgerBackupBundle): void {
  if (bundle.app !== "poke-deal") throw new Error("Backup bundle is not for Poke Deal.");
  if (bundle.schemaVersion !== LEDGER_BACKUP_SCHEMA_VERSION) {
    throw new Error(`Unsupported backup schema version ${bundle.schemaVersion}.`);
  }
  for (const tableName of LEDGER_BACKUP_TABLES) {
    if (!bundle.tables?.[tableName]) throw new Error(`Backup bundle is missing ${tableName}.`);
  }
}

async function resolveBundlePath(fileOrDirectory: string): Promise<string> {
  if (fileOrDirectory.endsWith(".json")) return fileOrDirectory;
  const files = await readdir(fileOrDirectory);
  const bundle = files.find((file) => file.startsWith("poke-deal-backup-") && file.endsWith(".json"));
  if (!bundle) throw new Error(`No poke-deal-backup JSON found in ${fileOrDirectory}.`);
  return path.join(fileOrDirectory, bundle);
}

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
