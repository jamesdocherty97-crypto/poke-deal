// Inventory CSV v1. Read-only export and dry-run validation.
// Every cell is quoted, rows end in CRLF, and there is no BOM.
// A cell whose first character is = + - @ tab CR or ' gets exactly one leading apostrophe.
// Decode strips exactly one leading apostrophe from every cell.
//
// listing_ids joins source listing ids with ';' after sorting by createdAt, then id.
// Assumption: a source listing id does not contain ';'. This file does not strip,
// rename, or reject a delimiter inside a listing id, and the Listing id schema is
// unchanged. Limitation: a source id that contains ';' is copied verbatim into the
// joined cell, so splitting that cell is not the original id. The dry-run does not
// apply a separate id-character rule; a count mismatch can be a side effect of the
// join, not proof that the source id was checked.
//
// Listing price, state, and external_ref are intentionally absent. They remain in
// the separate existing listings export (GET /api/export/listings, listingsToCsv
// columns list_price_gbp, suggested_price_gbp, state, external_ref, and listing_id),
// joined on item_id.
//
// Null and empty string are indistinguishable in CSV. Nullable text and timestamps
// are written as an empty cell, and decoding that cell yields "".

export const INVENTORY_V1_SCHEMA = "inventory-v1";

export const INVENTORY_V1_COLUMNS = [
  "schema_version",
  "item_id",
  "card_id",
  "card_name",
  "set_name",
  "number",
  "language",
  "edition",
  "finish",
  "grade",
  "grader_cert",
  "condition",
  "location",
  "quantity",
  "currency",
  "cost_basis_pence",
  "inventory_status",
  "acquired_from",
  "acquired_at",
  "listing_count",
  "listing_ids",
] as const;

export type InventoryV1Column = (typeof INVENTORY_V1_COLUMNS)[number];

export type InventoryV1Row = Record<InventoryV1Column, string>;

export type InventoryExportListing = {
  id: string;
  createdAt: Date;
};

export type InventoryExportItem = {
  id: string;
  cardId: string;
  grade: string;
  graderCert: string | null;
  condition: string | null;
  quantity: number;
  costBasis: number;
  acquiredFrom: string | null;
  acquiredAt: Date | null;
  location: string | null;
  status: string;
  card: {
    id: string;
    name: string;
    setName: string;
    number: string | null;
    language: string | null;
    edition: string | null;
    finish: string | null;
  };
  listings: InventoryExportListing[];
};

export type InventoryV1LineError = {
  line: number;
  message: string;
};

export type InventoryV1Report = {
  ok: boolean;
  rowCount: number;
  errorCount: number;
  errors: InventoryV1LineError[];
  rows: InventoryV1Row[];
};

/** Database handle accepted by the dry-run so callers can prove it never writes. */
export type InventoryWriteRepo = object;

const FORMULA_LEAD = new Set(["=", "+", "-", "@", "\t", "\r", "'"]);
const POSITIVE_INT = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INT = /^(0|[1-9][0-9]*)$/;

export function inventoryV1Filename(now: Date = new Date()): string {
  return `pokemon-dealer-inventory-v1-${now.toISOString().slice(0, 10)}.csv`;
}

export function toInventoryV1Row(item: InventoryExportItem): InventoryV1Row {
  const listings = [...item.listings].sort(compareListings);
  return {
    schema_version: INVENTORY_V1_SCHEMA,
    item_id: item.id,
    card_id: item.cardId,
    card_name: item.card.name,
    set_name: item.card.setName,
    number: item.card.number ?? "",
    language: item.card.language ?? "",
    edition: item.card.edition ?? "",
    finish: item.card.finish ?? "",
    grade: item.grade,
    grader_cert: item.graderCert ?? "",
    condition: item.condition ?? "",
    location: item.location ?? "",
    quantity: String(item.quantity),
    currency: "GBP",
    cost_basis_pence: String(item.costBasis),
    inventory_status: item.status,
    acquired_from: item.acquiredFrom ?? "",
    acquired_at: item.acquiredAt ? item.acquiredAt.toISOString() : "",
    listing_count: String(listings.length),
    listing_ids: listings.map((listing) => listing.id).join(";"),
  };
}

export function inventoryItemsToCsv(items: readonly InventoryExportItem[]): string {
  return encodeInventoryV1(items.map(toInventoryV1Row));
}

export function encodeInventoryV1(rows: readonly InventoryV1Row[]): string {
  const lines = [
    INVENTORY_V1_COLUMNS.map((column) => quoteCell(column)).join(","),
    ...rows.map((row) => INVENTORY_V1_COLUMNS.map((column) => quoteCell(row[column])).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function validateInventoryV1(bytes: Uint8Array): InventoryV1Report {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return report(0, [{ line: 1, message: "file is not valid UTF-8" }], []);
  }

  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return report(0, [{ line: parsed.line, message: parsed.message }], []);
  }

  const [header, ...data] = parsed.records;
  if (!header || !headerMatches(header)) {
    return report(data.length, [{ line: 1, message: "header must match inventory-v1 columns exactly" }], []);
  }

  const errors: InventoryV1LineError[] = [];
  const decoded: InventoryV1Row[] = [];
  const seenItemIds = new Map<string, number>();

  for (let index = 0; index < data.length; index += 1) {
    const line = index + 2;
    const cells = data[index] ?? [];
    if (cells.length !== INVENTORY_V1_COLUMNS.length) {
      errors.push({
        line,
        message: `row has ${cells.length} columns, expected ${INVENTORY_V1_COLUMNS.length}`,
      });
      continue;
    }

    const row = cellsToRow(cells);
    decoded.push(row);
    errors.push(...rowErrors(row, line));

    const prior = seenItemIds.get(row.item_id);
    if (prior != null) {
      errors.push({ line, message: `duplicate item_id ${row.item_id}` });
    } else {
      seenItemIds.set(row.item_id, line);
    }
  }

  return report(data.length, errors, errors.length === 0 ? decoded : []);
}

// `_repo` is the only database handle this path receives. Dry-run validation must not call it.
export function dryRunInventoryV1(bytes: Uint8Array, _repo: InventoryWriteRepo): InventoryV1Report {
  return validateInventoryV1(bytes);
}

function compareListings(a: InventoryExportListing, b: InventoryExportListing): number {
  const time = a.createdAt.getTime() - b.createdAt.getTime();
  if (time !== 0) return time;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function quoteCell(value: string): string {
  return `"${protectFormula(value).replaceAll('"', '""')}"`;
}

function protectFormula(value: string): string {
  const lead = value.charAt(0);
  if (lead !== "" && FORMULA_LEAD.has(lead)) return `'${value}`;
  return value;
}

function unprotectFormula(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}

function headerMatches(cells: readonly string[]): boolean {
  if (cells.length !== INVENTORY_V1_COLUMNS.length) return false;
  return INVENTORY_V1_COLUMNS.every((column, index) => unprotectFormula(cells[index] ?? "") === column);
}

function cellsToRow(cells: readonly string[]): InventoryV1Row {
  const row = {} as InventoryV1Row;
  for (let index = 0; index < INVENTORY_V1_COLUMNS.length; index += 1) {
    const column = INVENTORY_V1_COLUMNS[index];
    const value = cells[index];
    if (column === undefined || value === undefined) {
      throw new Error("inventory v1 row is missing a column");
    }
    row[column] = unprotectFormula(value);
  }
  return row;
}

function rowErrors(row: InventoryV1Row, line: number): InventoryV1LineError[] {
  const errors: InventoryV1LineError[] = [];
  if (row.schema_version !== INVENTORY_V1_SCHEMA) {
    errors.push({ line, message: "schema_version must be inventory-v1" });
  }
  if (row.currency !== "GBP") {
    errors.push({ line, message: "currency must be GBP" });
  }
  if (!POSITIVE_INT.test(row.quantity)) {
    errors.push({ line, message: "quantity must be an integer >= 1" });
  }
  if (!NON_NEGATIVE_INT.test(row.cost_basis_pence)) {
    errors.push({ line, message: "cost_basis_pence must be an integer >= 0" });
  }
  if (!NON_NEGATIVE_INT.test(row.listing_count)) {
    errors.push({ line, message: "listing_count must be an integer >= 0" });
  } else if (String(listingIdCount(row.listing_ids)) !== row.listing_count) {
    errors.push({ line, message: "listing_count does not match listing_ids" });
  }
  return errors;
}

function listingIdCount(listingIds: string): number {
  if (listingIds === "") return 0;
  return listingIds.split(";").length;
}

function report(rowCount: number, errors: InventoryV1LineError[], rows: InventoryV1Row[]): InventoryV1Report {
  return {
    ok: errors.length === 0,
    rowCount,
    errorCount: errors.length,
    errors,
    rows,
  };
}

type ParsedCsv =
  | { ok: true; records: string[][] }
  | { ok: false; line: number; message: string };

function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let recordLine = 1;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index] ?? "";
    if (inQuotes) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\r" && text[index + 1] === "\n") {
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
      recordLine += 1;
      index += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
      recordLine += 1;
      continue;
    }
    cell += ch;
  }

  if (inQuotes) {
    return { ok: false, line: recordLine, message: "unterminated quoted cell" };
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  return { ok: true, records };
}
