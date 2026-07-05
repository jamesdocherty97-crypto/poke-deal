import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type DeepHealthSource = {
  id: string;
  label: string;
  role: string;
  required: boolean;
  status: "ok" | "fail" | "skipped";
  latencyMs: number;
  detail: string;
  checkedAt: string;
};

type DeepHealthReport = {
  checkedAt: string;
  sources: DeepHealthSource[];
};

const baseUrl = process.env.BASE_URL ?? "https://poke-deal.vercel.app";
const url = new URL("/api/system/health", baseUrl);
const response = await fetch(url, { headers: headers() });
const text = await response.text();

let report: DeepHealthReport;
try {
  report = JSON.parse(text) as DeepHealthReport;
} catch {
  throw new Error(`Health endpoint returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
}

console.log(`Poke Deal health: ${url.toString()}`);
console.log(`Checked at: ${report.checkedAt}`);
console.table(
  report.sources.map((source) => ({
    status: source.status.toUpperCase(),
    source: source.label,
    ms: source.latencyMs,
    detail: source.detail,
  })),
);

const reportDate = new Date(report.checkedAt || Date.now()).toISOString().slice(0, 10);
const outPath = path.join(process.cwd(), `docs/HEALTH_CHECK_${reportDate}.md`);
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, renderReport(report, url.toString(), reportDate), "utf8");
console.log(`Wrote ${outPath}`);

const requiredFailures = report.sources.filter((source) => source.required && source.status === "fail");
const optionalFailures = report.sources.filter((source) => !source.required && source.status === "fail");
if (optionalFailures.length > 0) {
  console.error(`\n${optionalFailures.length} optional source${optionalFailures.length === 1 ? "" : "s"} failed; see details above.`);
}
if (requiredFailures.length > 0) {
  console.error(`\n${requiredFailures.length} required source${requiredFailures.length === 1 ? "" : "s"} failed.`);
  process.exit(response.ok ? 1 : response.status);
}

if (!response.ok) {
  console.error(`\nHealth endpoint returned HTTP ${response.status}.`);
  process.exit(response.status);
}

function headers(): Record<string, string> {
  const result: Record<string, string> = { accept: "application/json" };
  const basic = process.env.POKE_DEAL_BASIC_AUTH ?? process.env.VERIFY_PROD_BASIC_AUTH;
  if (basic) result.authorization = `Basic ${Buffer.from(basic).toString("base64")}`;
  return result;
}

function renderReport(report: DeepHealthReport, url: string, date: string): string {
  return [
    `# Deep Source Health - ${date}`,
    "",
    `Checked against production at \`${url}\` on ${report.checkedAt}.`,
    "",
    "| Status | Source | Required | Detail | Latency |",
    "|---|---|---|---|---|",
    ...report.sources.map((source) =>
      `| ${source.status.toUpperCase()} | ${escapeCell(source.label)} | ${source.required ? "yes" : "no"} | ${escapeCell(source.detail)} | ${source.latencyMs}ms |`,
    ),
    "",
    "## Notes",
    "",
    "- Required source failures fail the health gate.",
    "- Optional failures/skips stay visible so the dealer can see what is not live.",
    "",
  ].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
