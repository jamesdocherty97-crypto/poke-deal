import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type JobSpec = {
  job: string;
  label: string;
  maxAgeHours: number;
};

type CronRow = {
  id: string;
  job: string;
  runKey: string;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  startedAt: Date;
  finishedAt: Date | null;
  details: unknown;
  error: string | null;
};

type CronReportRow = {
  label: string;
  job: string;
  status: "OK" | "STALE" | "FAILED" | "MISSING";
  lastSuccess: CronRow | null;
  latest: CronRow | null;
  note: string;
};

const jobs: JobSpec[] = [
  { job: "daily-portfolio-snapshot", label: "Daily portfolio snapshot", maxAgeHours: 36 },
  { job: "daily-buy-watch-check", label: "Daily buy-watch check", maxAgeHours: 36 },
  { job: "daily-ebay-sales-sync", label: "Daily eBay sales sync", maxAgeHours: 36 },
  { job: "weekly-stock-health-reprice", label: "Weekly stock health reprice", maxAgeHours: 8 * 24 },
];

await loadLocalEnv();

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is missing; cannot inspect cron run log.");
}

const { getPrisma } = await import("../src/lib/db/prisma.js");
const now = new Date();
const db = getPrisma();
const rows = (await db.cronRun.findMany({
  orderBy: { startedAt: "desc" },
  take: 80,
})) as CronRow[];
const recentFailures = await db.appAlert.findMany({
  where: { kind: "CRON_FAILURE" },
  orderBy: { createdAt: "desc" },
  take: 10,
});

const reportRows = jobs.map((job) => inspectJob(job, rows, now));
const outPath = path.join(process.cwd(), "docs/CRON_HEALTH_2026-07-04.md");
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, renderReport(reportRows, recentFailures, now), "utf8");

console.log(`Wrote ${outPath}`);
console.table(reportRows.map((row) => ({
  status: row.status,
  job: row.label,
  lastSuccess: row.lastSuccess?.startedAt.toISOString() ?? "none",
  note: row.note,
})));

if (reportRows.some((row) => row.status !== "OK")) process.exit(1);

function inspectJob(job: JobSpec, rows: CronRow[], now: Date): CronReportRow {
  const matching = rows.filter((row) => row.job === job.job);
  const latest = matching[0] ?? null;
  const lastSuccess = matching.find((row) => row.status === "SUCCESS") ?? null;
  if (latest?.status === "FAILED") {
    return {
      label: job.label,
      job: job.job,
      status: "FAILED",
      lastSuccess,
      latest,
      note: latest.error ?? "Latest run failed.",
    };
  }
  if (!lastSuccess) {
    return {
      label: job.label,
      job: job.job,
      status: "MISSING",
      lastSuccess,
      latest,
      note: latest ? `Latest run is ${latest.status}.` : "No run log rows found.",
    };
  }
  const ageHours = (now.getTime() - lastSuccess.startedAt.getTime()) / 3_600_000;
  if (ageHours > job.maxAgeHours) {
    return {
      label: job.label,
      job: job.job,
      status: "STALE",
      lastSuccess,
      latest,
      note: `Last success is ${Math.round(ageHours)}h old; expected under ${job.maxAgeHours}h.`,
    };
  }
  return {
    label: job.label,
    job: job.job,
    status: "OK",
    lastSuccess,
    latest,
    note: `Last success ${Math.round(ageHours)}h ago.`,
  };
}

function renderReport(rows: CronReportRow[], alerts: Array<{ title: string; message: string; createdAt: Date | string }>, now: Date): string {
  return [
    "# Cron Health — 2026-07-04",
    "",
    `Checked at: ${now.toISOString()}`,
    "",
    "| Status | Job | Latest successful run | Latest run | Note |",
    "|---|---|---|---|---|",
    ...rows.map((row) =>
      `| ${row.status} | ${escapeCell(row.label)} | ${row.lastSuccess ? `${row.lastSuccess.runKey} · ${row.lastSuccess.startedAt.toISOString()}` : "none"} | ${row.latest ? `${row.latest.runKey} · ${row.latest.status}` : "none"} | ${escapeCell(row.note)} |`,
    ),
    "",
    "## Recent Cron Failure Inbox Entries",
    "",
    alerts.length > 0
      ? [
          "| Created | Title | Message |",
          "|---|---|---|",
          ...alerts.map((alert) => `| ${new Date(alert.createdAt).toISOString()} | ${escapeCell(alert.title)} | ${escapeCell(alert.message)} |`),
        ].join("\n")
      : "No recent cron failure inbox entries.",
    "",
  ].join("\n");
}

async function loadLocalEnv(): Promise<void> {
  const candidates = [".env", ".env.local", ".vercel/.env.production.local"];
  for (const file of candidates) {
    const fullPath = path.join(process.cwd(), file);
    if (!existsSync(fullPath)) continue;
    const text = await readFile(fullPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1]!;
      if (process.env[key]) continue;
      process.env[key] = unquoteEnv(match[2] ?? "");
    }
  }
}

function unquoteEnv(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
