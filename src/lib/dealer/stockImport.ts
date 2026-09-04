import { parseAcquisitionDate } from "../inventory/acquiredAt.js";
import { GRADE_VALUES, type Grade } from "../domain/types.js";
import { parseQuickIntake } from "./intakeParser.js";

export type ImportChannel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
export type ImportListingState = "DRAFT" | "ACTIVE";

export interface StockImportRow {
  card: {
    name: string;
    setName?: string;
    number?: string;
    language?: "EN" | "JP";
    edition?: "UNLIMITED" | "FIRST_EDITION" | "SHADOWLESS" | "STAFF" | "PRERELEASE";
    finish?: "NORMAL" | "HOLO" | "REVERSE_HOLO";
  };
  grade: Grade;
  costBasisPence: number;
  quantity: number;
  acquiredFrom?: string;
  acquiredAt?: string;
  location?: string;
  condition?: string;
  graderCert?: string;
  channel?: ImportChannel;
  listPricePence?: number;
  listingState?: ImportListingState;
}

export interface StockImportError {
  line: number;
  message: string;
}

export interface StockImportParseResult {
  rows: StockImportRow[];
  errors: StockImportError[];
  totalCostPence: number;
  totalQuantity: number;
  listingCount: number;
  explicitListPriceCount: number;
}

const ORDERED_COLUMNS = [
  "name",
  "setName",
  "number",
  "grade",
  "cost",
  "quantity",
  "acquiredFrom",
  "location",
  "channel",
  "listPrice",
  "listingState",
  "condition",
  "graderCert",
  "acquiredAt",
  "language",
  "edition",
  "finish",
] as const;

type OrderedColumn = (typeof ORDERED_COLUMNS)[number];

const SUPPORTED_GRADES = new Set<Grade>(GRADE_VALUES);


const HEADER_ALIASES: Record<string, OrderedColumn> = {
  "acquired date": "acquiredAt",
  "purchase date": "acquiredAt",
  acquiredat: "acquiredAt",
  language: "language",
  edition: "edition",
  finish: "finish",
  card: "name",
  "card name": "name",
  name: "name",
  set: "setName",
  "set name": "setName",
  setname: "setName",
  number: "number",
  no: "number",
  grade: "grade",
  cost: "cost",
  "cost gbp": "cost",
  "buy price": "cost",
  "cost basis": "cost",
  qty: "quantity",
  quantity: "quantity",
  source: "acquiredFrom",
  "acquired from": "acquiredFrom",
  acquiredfrom: "acquiredFrom",
  location: "location",
  box: "location",
  condition: "condition",
  cond: "condition",
  cert: "graderCert",
  "cert number": "graderCert",
  "grader cert": "graderCert",
  "psa cert": "graderCert",
  gradercert: "graderCert",
  channel: "channel",
  platform: "channel",
  list: "listPrice",
  price: "listPrice",
  "list price": "listPrice",
  listprice: "listPrice",
  "list price gbp": "listPrice",
  state: "listingState",
  status: "listingState",
  "listing state": "listingState",
  listingstate: "listingState",
};

export function parseStockImportText(input: string): StockImportParseResult {
  const rows: StockImportRow[] = [];
  const errors: StockImportError[] = [];
  const lines = input
    .split(/\r?\n/)
    .map((line, index) => ({ text: line.trim(), line: index + 1 }))
    .filter((line) => line.text.length > 0);

  let header: OrderedColumn[] | null = null;
  if (lines[0] && looksLikeHeader(lines[0].text)) {
    header = splitDelimitedLine(lines[0].text).map((cell) => HEADER_ALIASES[normalizeHeader(cell)] ?? "name");
    lines.shift();
  }

  for (const line of lines) {
    const parsed = parseStockImportLine(line.text, header);
    if ("error" in parsed) {
      errors.push({ line: line.line, message: parsed.error });
    } else {
      rows.push(parsed.row);
    }
  }

  return {
    rows,
    errors,
    totalCostPence: rows.reduce((sum, row) => sum + row.costBasisPence * row.quantity, 0),
    totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    listingCount: rows.length,
    explicitListPriceCount: rows.filter((row) => row.listPricePence != null).length,
  };
}

function parseStockImportLine(
  line: string,
  header: OrderedColumn[] | null,
): { row: StockImportRow } | { error: string } {
  const cells = line.includes(",") || line.includes("\t") ? splitDelimitedLine(line) : null;
  if (!cells) return parseFreeformStockLine(line);

  const valueByColumn = new Map<OrderedColumn, string>();
  const columns = header ?? ORDERED_COLUMNS;
  cells.forEach((cell, index) => {
    const column = columns[index];
    if (column) valueByColumn.set(column, cell.trim());
  });

  return buildRow({
    name: valueByColumn.get("name"),
    setName: valueByColumn.get("setName"),
    number: valueByColumn.get("number"),
    grade: valueByColumn.get("grade"),
    cost: valueByColumn.get("cost"),
    quantity: valueByColumn.get("quantity"),
    acquiredFrom: valueByColumn.get("acquiredFrom"),
    location: valueByColumn.get("location"),
    condition: valueByColumn.get("condition"),
    graderCert: valueByColumn.get("graderCert"),
    channel: valueByColumn.get("channel"),
    listPrice: valueByColumn.get("listPrice"),
    listingState: valueByColumn.get("listingState"),
    acquiredAt: valueByColumn.get("acquiredAt"),
    language: valueByColumn.get("language"),
    edition: valueByColumn.get("edition"),
    finish: valueByColumn.get("finish"),
  });
}

function parseFreeformStockLine(line: string): { row: StockImportRow } | { error: string } {
  // Quick intake extracts a convenient preview and can truncate a longer money
  // token. Validate the original amount before using that preview for stock.
  for (const match of line.matchAll(/(?:£\s*|\b(?:paid|cost|buy|bought|for|total|bundle|lot)\s+(?:(?:price|cost|paid|for)\s+)?)([+-]?\d[^\s]*)/gi)) {
    if (parseOptionalMoneyPence(match[1]) === false) {
      return { error: "cost must be a GBP amount with at most two decimal places, up to £21,474,836.47" };
    }
  }
  const parsed = parseQuickIntake(line);
  return buildRow({
    name: parsed.name,
    setName: parsed.setName,
    number: parsed.number,
    grade: parsed.grade,
    cost: parsed.cost,
    quantity: parsed.quantity,
    acquiredFrom: parsed.source,
    location: parsed.location,
    condition: parsed.condition,
    graderCert: parsed.graderCert,
    channel: parsed.channel,
    listingState: parsed.listingState,
  });
}

function buildRow(input: {
  name?: string;
  setName?: string;
  number?: string;
  grade?: string;
  cost?: string;
  quantity?: string;
  acquiredFrom?: string;
  acquiredAt?: string;
  location?: string;
  condition?: string;
  graderCert?: string;
  channel?: string;
  listPrice?: string;
  listingState?: string;
  language?: string;
  edition?: string;
  finish?: string;
}): { row: StockImportRow } | { error: string } {
  const name = clean(input.name);
  if (!name) return { error: "missing card name" };

  const costBasisPence = parseOptionalMoneyPence(input.cost);
  if (costBasisPence == null) return { error: "missing cost" };
  if (costBasisPence === false) return { error: "cost must be a GBP amount with at most two decimal places, up to £21,474,836.47" };

  const quantity = parseQuantity(input.quantity);
  if (quantity == null) return { error: "quantity must be a whole number from 1 to 2,147,483,647" };

  const grade = normalizeGrade(input.grade);
  if (!grade) return { error: "unsupported grade" };

  const listPricePence = parseOptionalMoneyPence(input.listPrice);
  if (listPricePence === false) return { error: "list price must be a GBP amount with at most two decimal places, up to £21,474,836.47" };
  if (listPricePence === 0) return { error: "list price must be above £0; leave it blank for an unpriced draft" };

  const channel = normalizeChannel(input.channel);
  if (input.channel && !channel) return { error: "unsupported channel" };

  const listingState = normalizeListingState(input.listingState);
  if (input.listingState && !listingState) return { error: "unsupported listing state" };

  let acquiredAt: string | undefined;
  try { acquiredAt = parseAcquisitionDate(input.acquiredAt); }
  catch (error) { return { error: error instanceof Error ? error.message : "invalid acquisition date" }; }
  const language = clean(input.language)?.toUpperCase();
  const edition = clean(input.edition)?.toUpperCase().replace(/[ -]+/g, "_");
  const finish = clean(input.finish)?.toUpperCase().replace(/[ -]+/g, "_");
  if (language && !["EN", "JP"].includes(language)) return { error: "language must be EN or JP" };
  if (edition && !["UNLIMITED", "FIRST_EDITION", "SHADOWLESS", "STAFF", "PRERELEASE"].includes(edition)) return { error: "unsupported printing edition" };
  if (finish && !["NORMAL", "HOLO", "REVERSE_HOLO"].includes(finish)) return { error: "finish must be NORMAL, HOLO or REVERSE_HOLO" };

  return {
    row: {
      ...(acquiredAt ? { acquiredAt } : {}),
      card: {
        name,
        ...(language ? { language: language as "EN" | "JP" } : {}),
        ...(edition ? { edition: edition as NonNullable<StockImportRow["card"]["edition"]> } : {}),
        ...(finish ? { finish: finish as NonNullable<StockImportRow["card"]["finish"]> } : {}),
        ...(clean(input.setName) ? { setName: clean(input.setName) } : {}),
        ...(clean(input.number) ? { number: clean(input.number) } : {}),
      },
      grade,
      costBasisPence,
      quantity,
      ...(clean(input.acquiredFrom) ? { acquiredFrom: clean(input.acquiredFrom) } : {}),
      ...(clean(input.location) ? { location: clean(input.location) } : {}),
      ...(clean(input.condition) ? { condition: clean(input.condition) } : {}),
      ...(clean(input.graderCert) ? { graderCert: clean(input.graderCert) } : {}),
      ...(channel ? { channel } : {}),
      ...(listPricePence != null ? { listPricePence } : {}),
      ...(listingState ? { listingState } : {}),
    },
  };
}

function looksLikeHeader(line: string): boolean {
  const cells = splitDelimitedLine(line);
  const mapped = cells.filter((cell) => HEADER_ALIASES[normalizeHeader(cell)]);
  return mapped.length >= 2 && mapped.length >= Math.ceil(cells.length / 2);
}

function splitDelimitedLine(line: string): string[] {
  const separator = line.includes("\t") ? "\t" : ",";
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === separator && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseOptionalMoneyPence(value: string | undefined): number | null | false {
  const cleaned = clean(value);
  if (!cleaned) return null;
  // Accept explicit GBP notation and correctly grouped thousands, never strip
  // unknown text into an apparent zero-cost purchase or round extra decimals.
  const match = cleaned.match(/^(?:£\s*)?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/);
  if (!match) return false;
  const pence = Number(match[1]!.replace(/,/g, "")) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(pence) && pence <= 2_147_483_647 ? pence : false;
}

function parseQuantity(value: string | undefined): number | null {
  const cleaned = clean(value);
  if (!cleaned) return 1;
  const numeric = Number(cleaned);
  return Number.isInteger(numeric) && numeric > 0 && numeric <= 2_147_483_647 ? numeric : null;
}

function normalizeGrade(value: string | undefined): Grade | null {
  const normalized = clean(value).toUpperCase().replace(/\s+/g, "_").replace(".", "_");
  if (!normalized || ["RAW", "UNGRADED", "NM", "NEAR_MINT"].includes(normalized)) return "RAW";
  const gradeMatch = normalized.match(/^(PSA|BGS|CGC|ACE)_?(\d+)(?:_(\d+))?$/);
  const grade = gradeMatch
    ? ([gradeMatch[1], gradeMatch[2], gradeMatch[3]].filter(Boolean).join("_") as Grade)
    : (normalized as Grade);
  return SUPPORTED_GRADES.has(grade) ? grade : null;
}

function normalizeChannel(value: string | undefined): ImportChannel | null {
  const normalized = clean(value).toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return null;
  if (normalized === "ebay") return "EBAY";
  if (normalized === "cardmarket") return "CARDMARKET";
  if (normalized === "vinted") return "VINTED";
  if (normalized === "inperson" || normalized === "cash" || normalized === "fair") return "IN_PERSON";
  return null;
}

function normalizeListingState(value: string | undefined): ImportListingState | null {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return null;
  if (normalized === "draft") return "DRAFT";
  if (normalized === "active" || normalized === "listed") return "ACTIVE";
  return null;
}

function clean(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function normalizeHeader(value: string): string {
  return clean(value).toLowerCase().replace(/[_-]+/g, " ");
}
