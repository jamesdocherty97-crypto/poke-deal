type Probe = {
  slug: string;
  label: string;
  params: Record<string, string>;
  assert: (json: CompResponse) => string[];
};

type CompResponse = {
  ambiguous?: boolean;
  alternatives?: unknown[];
  headline?: {
    source?: string;
    medianPence?: number;
    sampleSize?: number;
    card?: { name?: string; number?: string };
    raw?: unknown;
  };
  all?: Array<{
    source?: string;
    medianPence?: number;
    meanPence?: number;
    lowPence?: number;
    highPence?: number;
    sampleSize?: number;
    raw?: unknown;
  }>;
  reconciliation?: {
    confidence?: string;
    manualCheck?: boolean;
    reasons?: string[];
    trendPct?: number | null;
  };
  unavailableSources?: Array<{ name?: string; reason?: string }>;
};

type Result = {
  label: string;
  ok: boolean;
  headline: string;
  details: string;
  raw?: unknown;
};

const baseUrl = process.env.BASE_URL ?? "https://poke-deal.vercel.app";

const probes: Probe[] = [
  {
    slug: "umbreon-evolving-skies-raw",
    label: "Umbreon + Evolving Skies RAW",
    params: { name: "Umbreon", setName: "Evolving Skies", grade: "RAW" },
    assert: (json) => [
      json.ambiguous === true ? "" : "expected ambiguous=true",
      (json.alternatives?.length ?? 0) >= 5 ? "" : `expected at least 5 alternatives, got ${json.alternatives?.length ?? 0}`,
      inBand(json.headline?.medianPence, 10_500, 12_500)
        ? `headline still looks like the old £116 bug (${formatPence(json.headline?.medianPence)})`
        : "",
    ],
  },
  {
    slug: "charizard-base-4-102-raw",
    label: "Charizard Base 4/102 RAW",
    params: { name: "Charizard", setName: "Base", number: "4/102", grade: "RAW" },
    assert: (json) => [
      inBand(json.headline?.medianPence, 15_000, 40_000)
        ? ""
        : `headline ${formatPence(json.headline?.medianPence)} outside £150-£400 band`,
      hasCardmarketTrendPriceBug(json) ? "evidence contains Cardmarket trendPrice around £3,576" : "",
      hasWrongPokeTraceCharizardRow(json) ? "evidence contains wrong-card PokeTrace row around £153" : "",
    ],
  },
  {
    slug: "umbreon-vmax-215-203-raw",
    label: "Umbreon VMAX 215/203 RAW",
    params: { name: "Umbreon VMAX", setName: "Evolving Skies", number: "215/203", grade: "RAW" },
    assert: (json) => [
      json.reconciliation?.manualCheck === true ? "" : "expected manualCheck=true",
      (json.reconciliation?.reasons?.length ?? 0) > 0 ? "" : "expected non-empty reconciliation reasons",
    ],
  },
  {
    slug: "charizard-ex-151-199-165-psa10",
    label: "Charizard ex 151 199/165 PSA 10",
    params: { name: "Charizard ex", setName: "151", number: "199/165", grade: "PSA_10" },
    assert: (json) => [
      json.reconciliation?.trendPct == null ? "" : `expected null/absent trend, got ${json.reconciliation.trendPct}`,
      json.reconciliation?.confidence === "medium"
        ? ""
        : `expected medium confidence, got ${json.reconciliation?.confidence ?? "missing"}`,
      json.reconciliation?.manualCheck === false ? "" : "expected manualCheck=false",
    ],
  },
  {
    slug: "victini-svp-208-raw",
    label: "Victini SVP 208 RAW",
    params: { name: "Victini", setName: "Scarlet & Violet Promos", number: "SVP 208", grade: "RAW" },
    assert: (json) => {
      const primaryUnavailable = json.unavailableSources?.some((source) => source.name === "pokemon-price-tracker") === true;
      const expectedConfidence = primaryUnavailable ? ["medium", "high"] : ["high"];
      return [
        normalizeIdentityPart(json.headline?.card?.name) === "victini" ? "" : "headline identity was not Victini",
        normalizeIdentityPart(json.headline?.card?.number) === "svp208" ? "" : "headline collector number was not SVP208",
        inBand(json.headline?.medianPence, 900, 1_600)
          ? ""
          : `headline ${formatPence(json.headline?.medianPence)} outside the £9-£16 live-market guardrail`,
        (json.headline?.sampleSize ?? 0) >= 3 ? "" : "expected at least three observations",
        expectedConfidence.includes(json.reconciliation?.confidence ?? "")
          ? ""
          : `expected ${expectedConfidence.join("/")} confidence, got ${json.reconciliation?.confidence ?? "missing"}`,
        json.reconciliation?.manualCheck === false ? "" : "expected manualCheck=false",
      ];
    },
  },
];

const results: Result[] = [];

for (const probe of probes) {
  const json = await fetchComp(probe);
  const failures = probe.assert(json).filter(Boolean);
  results.push({
    label: probe.label,
    ok: failures.length === 0,
    headline: summarizeHeadline(json),
    details: failures.length === 0 ? "PASS" : failures.join("; "),
    raw: failures.length === 0 ? undefined : json,
  });
}

printResults(results);

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error("\nRaw JSON for failed probes:");
  for (const result of failed) {
    console.error(`\n## ${result.label}`);
    console.error(JSON.stringify(result.raw, null, 2));
  }
  process.exit(1);
}

async function fetchComp(probe: Probe): Promise<CompResponse> {
  const url = new URL("/api/comps", baseUrl);
  for (const [key, value] of Object.entries(probe.params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: headers() });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${probe.label} returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`${probe.label} returned HTTP ${response.status}: ${JSON.stringify(json).slice(0, 1_000)}`);
  }
  return json as CompResponse;
}

function headers(): Record<string, string> {
  const result: Record<string, string> = { accept: "application/json" };
  const basic = process.env.POKE_DEAL_BASIC_AUTH ?? process.env.VERIFY_PROD_BASIC_AUTH;
  if (basic) result.authorization = `Basic ${Buffer.from(basic).toString("base64")}`;
  return result;
}

function printResults(results: Result[]): void {
  const rows = results.map((result) => ({
    status: result.ok ? "PASS" : "FAIL",
    card: result.label,
    headline: result.headline,
    detail: result.details,
  }));
  console.log(`Production verifier: ${baseUrl}`);
  console.table(rows);
}

function summarizeHeadline(json: CompResponse): string {
  const source = json.headline?.source ?? "none";
  const price = formatPence(json.headline?.medianPence);
  const confidence = json.reconciliation?.confidence ?? "n/a";
  const manual = json.reconciliation?.manualCheck === true ? "manual" : "auto";
  return `${price} · ${source} · ${confidence} · ${manual}`;
}

function formatPence(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `£${(value / 100).toFixed(2)}` : "missing";
}

function inBand(value: number | undefined, low: number, high: number): boolean {
  return typeof value === "number" && value >= low && value <= high;
}

function normalizeIdentityPart(value: string | undefined): string {
  return value?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}

function hasCardmarketTrendPriceBug(json: CompResponse): boolean {
  return (json.all ?? []).some((result) => {
    if (result.source !== "pokemon-tcg-market") return false;
    return collectObjects(result.raw).some((value) => {
      const source = readString(value.source).toLowerCase();
      const kind = readString(value.kind).toLowerCase();
      const pricePence = readNumber(value.pricePence);
      return source === "cardmarket" && kind === "trendprice" && inBand(pricePence, 340_000, 370_000);
    });
  });
}

function hasWrongPokeTraceCharizardRow(json: CompResponse): boolean {
  return (json.all ?? []).some((result) => {
    if (result.source !== "poketrace") return false;
    return [result.medianPence, result.meanPence, result.lowPence, result.highPence].some((value) => inBand(value, 14_500, 16_000));
  });
}

function collectObjects(value: unknown): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  visit(value);
  return found;

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    found.push(node as Record<string, unknown>);
    for (const item of Object.values(node)) visit(item);
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
