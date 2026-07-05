import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Fixture = {
  capturedAt: string;
  request: {
    card: {
      name: string;
      setName?: string;
      number?: string;
      tcgApiId?: string;
    };
    grade?: string;
  };
  response: CompResponse;
};

type CompResponse = {
  ambiguous?: boolean;
  alternatives?: unknown[];
  catalog?: {
    name?: string;
    setName?: string;
    number?: string | null;
    tcgApiId?: string | null;
  } | null;
  headline?: {
    source?: string;
    medianPence?: number;
    sampleSize?: number;
  } | null;
  reconciliation?: {
    confidence?: string;
    manualCheck?: boolean;
    reasons?: string[];
  };
};

type DriftRow = {
  file: string;
  request: string;
  expected: string;
  actual: string;
  status: "OK" | "DRIFT" | "ERROR";
  notes: string[];
};

const baseUrl = process.env.BASE_URL ?? "https://poke-deal.vercel.app";
const fixtureDir = path.join(process.cwd(), "src/lib/comps/__fixtures__/live-regression");
const reportDate = new Date().toISOString().slice(0, 10);
const outPath = path.join(process.cwd(), `docs/COMPS_DRIFT_${reportDate}.md`);
const files = (await readdir(fixtureDir)).filter((file) => file.endsWith(".json")).sort();
const rows: DriftRow[] = [];

for (const file of files) {
  const fixture = JSON.parse(await readFile(path.join(fixtureDir, file), "utf8")) as Fixture;
  try {
    const actual = await fetchComp(fixture);
    rows.push(compareFixture(file, fixture, actual));
  } catch (err) {
    rows.push({
      file,
      request: requestLabel(fixture),
      expected: summarize(fixture.response),
      actual: "fetch failed",
      status: "ERROR",
      notes: [err instanceof Error ? err.message : "unknown fetch error"],
    });
  }
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, renderReport(rows), "utf8");

console.log(`Wrote ${outPath}`);
console.table(rows.map((row) => ({
  status: row.status,
  file: row.file,
  expected: row.expected,
  actual: row.actual,
  notes: row.notes.join("; "),
})));

if (rows.some((row) => row.status === "ERROR")) process.exit(1);

async function fetchComp(fixture: Fixture): Promise<CompResponse> {
  const url = new URL("/api/comps", baseUrl);
  const card = fixture.request.card;
  url.searchParams.set("name", card.name);
  if (card.setName) {
    url.searchParams.set("set", card.setName);
    url.searchParams.set("setName", card.setName);
  }
  if (card.number) url.searchParams.set("number", card.number);
  if (card.tcgApiId) url.searchParams.set("tcgApiId", card.tcgApiId);
  if (fixture.request.grade) url.searchParams.set("grade", fixture.request.grade);

  const response = await fetch(url, { headers: headers() });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status} non-JSON: ${text.slice(0, 240)}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json as CompResponse;
}

function compareFixture(file: string, fixture: Fixture, actual: CompResponse): DriftRow {
  const expected = fixture.response;
  const notes: string[] = [];
  const expectedMedian = expected.headline?.medianPence ?? null;
  const actualMedian = actual.headline?.medianPence ?? null;

  if (expected.catalog || actual.catalog) {
    const expectedCatalog = catalogKey(expected.catalog);
    const actualCatalog = catalogKey(actual.catalog);
    if (expectedCatalog !== actualCatalog) notes.push(`catalog ${expectedCatalog || "none"} -> ${actualCatalog || "none"}`);
  }
  if (Boolean(expected.ambiguous) !== Boolean(actual.ambiguous)) notes.push(`ambiguous ${Boolean(expected.ambiguous)} -> ${Boolean(actual.ambiguous)}`);
  if ((expected.reconciliation?.confidence ?? "missing") !== (actual.reconciliation?.confidence ?? "missing")) {
    notes.push(`confidence ${expected.reconciliation?.confidence ?? "missing"} -> ${actual.reconciliation?.confidence ?? "missing"}`);
  }
  if (Boolean(expected.reconciliation?.manualCheck) !== Boolean(actual.reconciliation?.manualCheck)) {
    notes.push(`manual ${Boolean(expected.reconciliation?.manualCheck)} -> ${Boolean(actual.reconciliation?.manualCheck)}`);
  }
  if ((expected.headline?.source ?? "none") !== (actual.headline?.source ?? "none")) {
    notes.push(`headline source ${expected.headline?.source ?? "none"} -> ${actual.headline?.source ?? "none"}`);
  }
  if (expectedMedian == null && actualMedian != null) notes.push(`new headline ${formatPence(actualMedian)}`);
  if (expectedMedian != null && actualMedian == null) notes.push(`lost headline ${formatPence(expectedMedian)}`);
  if (expectedMedian != null && actualMedian != null) {
    const pct = Math.abs(actualMedian - expectedMedian) / Math.max(expectedMedian, 1);
    if (pct > 0.25) notes.push(`headline moved ${formatPence(expectedMedian)} -> ${formatPence(actualMedian)} (${Math.round(pct * 100)}%)`);
  }

  return {
    file,
    request: requestLabel(fixture),
    expected: summarize(expected),
    actual: summarize(actual),
    status: notes.length > 0 ? "DRIFT" : "OK",
    notes,
  };
}

function renderReport(rows: DriftRow[]): string {
  const counts = rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { OK: 0, DRIFT: 0, ERROR: 0 } as Record<DriftRow["status"], number>,
  );
  return [
    `# Production Comp Drift - ${reportDate}`,
    "",
    `Base URL: ${baseUrl}`,
    `Corpus: ${rows.length} pinned live-regression cards`,
    `Summary: ${counts.OK} OK · ${counts.DRIFT} drift · ${counts.ERROR} error`,
    "",
    "| Status | Fixture | Request | Expected | Production | Notes |",
    "|---|---|---|---|---|---|",
    ...rows.map((row) =>
      `| ${row.status} | \`${row.file}\` | ${escapeCell(row.request)} | ${escapeCell(row.expected)} | ${escapeCell(row.actual)} | ${escapeCell(row.notes.join("; ") || "-")} |`,
    ),
    "",
    "Drift here is intentionally diagnostic. Price-source and price movement can be legitimate; identity, confidence, and manual-check drift should be reviewed before changing reconciler behaviour.",
    "",
  ].join("\n");
}

function requestLabel(fixture: Fixture): string {
  const card = fixture.request.card;
  return [card.name, card.setName, card.number, fixture.request.grade?.replace(/_/g, " ")].filter(Boolean).join(" · ");
}

function summarize(response: CompResponse): string {
  const price = response.headline?.medianPence == null ? "no headline" : formatPence(response.headline.medianPence);
  const source = response.headline?.source ?? "none";
  const confidence = response.reconciliation?.confidence ?? "n/a";
  const manual = response.reconciliation?.manualCheck ? "manual" : "auto";
  return `${price} · ${source} · ${confidence} · ${manual}`;
}

function catalogKey(catalog: CompResponse["catalog"]): string {
  if (!catalog) return "";
  return [catalog.name, catalog.setName, catalog.number].filter(Boolean).join(" ");
}

function formatPence(value: number): string {
  return `£${(value / 100).toFixed(2)}`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function headers(): Record<string, string> {
  const result: Record<string, string> = { accept: "application/json" };
  const basic = process.env.POKE_DEAL_BASIC_AUTH ?? process.env.VERIFY_PROD_BASIC_AUTH;
  if (basic) result.authorization = `Basic ${Buffer.from(basic).toString("base64")}`;
  return result;
}
