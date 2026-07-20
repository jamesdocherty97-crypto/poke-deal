import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import {
  latestProviderEvidenceForGroup,
  type CompAuditForDrift,
} from "../src/lib/comps/checkedProviderDrift.js";
import { normalizeRawCondition } from "../src/lib/comps/pricing.js";
import {
  mapCheckedCompsToComp,
  type CheckedCompRow,
} from "../src/lib/comps/sources/checkedComps.js";
import type { Grade, RawCondition } from "../src/lib/domain/types.js";
import { formatGbp } from "../src/lib/format/money.js";

const WINDOW_DAYS = 90;
const MIN_QUALIFIED_CHECKED_COMPS = 2;
const now = new Date();
const cutoff = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1_000);
const databaseUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL)?.trim();
const generatedAt = now.toISOString();
const reportPath = path.join(
  process.cwd(),
  "output/audits",
  `checked-provider-drift-${generatedAt.replace(/[:.]/g, "-")}.json`,
);

type QualifiedCheckedGroup = {
  cardId: string;
  cardName: string;
  setName: string;
  number: string | null;
  tcgApiId: string | null;
  tcgDexId: string | null;
  cardmarketId: string | null;
  grade: Grade;
  condition?: RawCondition;
  medianPence: number;
  sampleSize: number;
  lowPence: number;
  highPence: number;
  asOf: string;
};

type CheckedProviderDriftRow = {
  identity: {
    cardId: string;
    cardName: string;
    setName: string;
    number: string | null;
    tcgApiId: string | null;
    tcgDexId: string | null;
    cardmarketId: string | null;
    grade: Grade;
    condition: RawCondition | null;
  };
  checked: {
    source: "checked-comps";
    medianPence: number;
    sampleSize: number;
    lowPence: number;
    highPence: number;
    windowDays: number;
    asOf: string;
  };
  provider: {
    source: string;
    medianPence: number;
    sampleSize: number;
    windowDays: number;
    asOf: string;
    recordedAt: string;
  };
  providerToCheckedRatio: number;
};

type CheckedProviderDriftReport = {
  generatedAt: string;
  windowDays: number;
  readOnlyTables: ["CheckedComp", "CompResult"];
  summary: {
    recentActiveCheckedRows: number;
    qualifiedCheckedGroups: number;
    matchingProviderObservations: number;
    reportedComparisons: number;
  };
  emptyReason: string | null;
  rows: CheckedProviderDriftRow[];
};

if (!databaseUrl) {
  await writeReport({
    generatedAt,
    windowDays: WINDOW_DAYS,
    readOnlyTables: ["CheckedComp", "CompResult"],
    summary: {
      recentActiveCheckedRows: 0,
      qualifiedCheckedGroups: 0,
      matchingProviderObservations: 0,
      reportedComparisons: 0,
    },
    emptyReason: "DIRECT_URL/DATABASE_URL is not set, so no read-only database comparison could run.",
    rows: [],
  });
  process.exit(0);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const checkedRows = await prisma.checkedComp.findMany({
    where: {
      voidedAt: null,
      soldDate: { gte: cutoff, lte: now },
    },
    include: { card: true },
    orderBy: { soldDate: "asc" },
  }) as unknown as CheckedCompRow[];

  const qualifiedGroups = qualifyCheckedGroups(checkedRows);
  const cardIds = [...new Set(qualifiedGroups.map((group) => group.cardId))];
  const audits = cardIds.length === 0
    ? []
    : await prisma.compResult.findMany({
      where: {
        cardId: { in: cardIds },
        createdAt: { gte: cutoff, lte: now },
        asOf: { gte: cutoff, lte: now },
      },
      select: {
        cardId: true,
        grade: true,
        condition: true,
        source: true,
        medianPence: true,
        sampleSize: true,
        windowDays: true,
        asOf: true,
        createdAt: true,
        receipt: true,
      },
      orderBy: { createdAt: "desc" },
    }) as unknown as CompAuditForDrift[];

  const rows = buildRows(qualifiedGroups, audits);
  const report: CheckedProviderDriftReport = {
    generatedAt,
    windowDays: WINDOW_DAYS,
    readOnlyTables: ["CheckedComp", "CompResult"],
    summary: {
      recentActiveCheckedRows: checkedRows.length,
      qualifiedCheckedGroups: qualifiedGroups.length,
      matchingProviderObservations: rows.length,
      reportedComparisons: rows.length,
    },
    emptyReason: emptyReason(checkedRows.length, qualifiedGroups.length, rows.length),
    rows,
  };
  await writeReport(report);
} finally {
  await prisma.$disconnect();
}

function qualifyCheckedGroups(rows: CheckedCompRow[]): QualifiedCheckedGroup[] {
  const grouped = new Map<string, CheckedCompRow[]>();
  for (const row of rows) {
    const condition = row.grade === "RAW" ? normalizeRawCondition(row.condition) : undefined;
    const key = [row.cardId, row.grade, condition ?? "UNSCOPED"].join("\u0000");
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  const qualified: QualifiedCheckedGroup[] = [];
  for (const groupRows of grouped.values()) {
    const first = groupRows[0];
    if (!first) continue;
    const condition = first.grade === "RAW" ? normalizeRawCondition(first.condition) ?? undefined : undefined;
    const comp = mapCheckedCompsToComp(groupRows, {
      source: "checked-comps",
      card: {
        id: first.card.id,
        name: first.card.name,
        setName: first.card.setName,
        number: first.card.number ?? undefined,
        tcgApiId: first.card.tcgApiId ?? undefined,
        tcgDexId: first.card.tcgDexId ?? undefined,
        cardmarketId: first.card.cardmarketId ?? undefined,
        game: first.card.game,
        language: first.card.language,
      },
      grade: first.grade,
      condition,
      windowDays: WINDOW_DAYS,
      now,
    });
    if (comp.sampleSize < MIN_QUALIFIED_CHECKED_COMPS) continue;
    qualified.push({
      cardId: first.cardId,
      cardName: first.card.name,
      setName: first.card.setName,
      number: first.card.number,
      tcgApiId: first.card.tcgApiId,
      tcgDexId: first.card.tcgDexId ?? null,
      cardmarketId: first.card.cardmarketId ?? null,
      grade: first.grade,
      condition,
      medianPence: comp.medianPence,
      sampleSize: comp.sampleSize,
      lowPence: comp.lowPence,
      highPence: comp.highPence,
      asOf: comp.asOf,
    });
  }
  return qualified.sort((a, b) => identityLabel(a).localeCompare(identityLabel(b)));
}

function buildRows(
  groups: QualifiedCheckedGroup[],
  audits: CompAuditForDrift[],
): CheckedProviderDriftRow[] {
  return groups.flatMap((group) =>
    latestProviderEvidenceForGroup(audits, group, now, WINDOW_DAYS).map((provider) => ({
      identity: {
        cardId: group.cardId,
        cardName: group.cardName,
        setName: group.setName,
        number: group.number,
        tcgApiId: group.tcgApiId,
        tcgDexId: group.tcgDexId,
        cardmarketId: group.cardmarketId,
        grade: group.grade,
        condition: group.condition ?? null,
      },
      checked: {
        source: "checked-comps" as const,
        medianPence: group.medianPence,
        sampleSize: group.sampleSize,
        lowPence: group.lowPence,
        highPence: group.highPence,
        windowDays: WINDOW_DAYS,
        asOf: group.asOf,
      },
      provider,
      providerToCheckedRatio: roundRatio(provider.medianPence / group.medianPence),
    })),
  );
}

async function writeReport(report: CheckedProviderDriftReport): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Checked-vs-provider drift: ${report.generatedAt}`);
  console.log(`Read-only sources: ${report.readOnlyTables.join(", ")}; ${report.windowDays}-day window.`);
  console.log(`Wrote ${reportPath}`);
  console.table(report.rows.map((row) => ({
    identity: identityLabel(row.identity),
    provider: row.provider.source,
    checkedMedian: formatGbp(row.checked.medianPence),
    providerMedian: formatGbp(row.provider.medianPence),
    ratio: row.providerToCheckedRatio,
    checkedSample: row.checked.sampleSize,
    providerSample: row.provider.sampleSize,
  })));
  if (report.rows.length === 0) {
    console.log(`No comparisons: ${report.emptyReason ?? "No exact identity overlap was found."}`);
  }
}

function emptyReason(checkedCount: number, qualifiedCount: number, rowCount: number): string | null {
  if (rowCount > 0) return null;
  if (checkedCount === 0) return `No active checked comps were sold in the last ${WINDOW_DAYS} days.`;
  if (qualifiedCount === 0) {
    return `No exact card + grade + condition group had at least ${MIN_QUALIFIED_CHECKED_COMPS} active qualified checked comps after evidence and outlier rules.`;
  }
  return `Qualified checked-comp groups exist, but none has a persisted provider comp for the same identity and ${WINDOW_DAYS}-day window within the last ${WINDOW_DAYS} days.`;
}

function identityLabel(identity: {
  cardName: string;
  setName: string;
  number: string | null;
  grade: Grade;
  condition?: RawCondition | null;
}): string {
  return [
    identity.cardName,
    identity.setName,
    identity.number,
    identity.grade.replace(/_/g, " "),
    identity.condition,
  ].filter(Boolean).join(" · ");
}

function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
