import type { Grade, RawCondition } from "../domain/types.js";

export type CheckedDriftGroup = {
  cardId: string;
  grade: Grade;
  condition?: RawCondition;
};

export type CompAuditForDrift = {
  cardId: string;
  grade: Grade;
  condition: string | null;
  source: string;
  medianPence: number;
  sampleSize: number;
  windowDays: number;
  asOf: Date;
  createdAt: Date;
  receipt: unknown;
};

export type ProviderEvidenceForDrift = {
  source: string;
  medianPence: number;
  sampleSize: number;
  windowDays: number;
  asOf: string;
  recordedAt: string;
};

const NON_PROVIDER_SOURCES = new Set(["checked-comps", "owned-sales", "manual-check"]);

export function latestProviderEvidenceForGroup(
  audits: CompAuditForDrift[],
  group: CheckedDriftGroup,
  now = new Date(),
  windowDays = 90,
): ProviderEvidenceForDrift[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1_000;
  const matchingAudits = audits
    .filter((audit) => audit.cardId === group.cardId && audit.grade === group.grade)
    .filter((audit) => (audit.condition ?? undefined) === group.condition)
    .filter((audit) => audit.createdAt.getTime() >= cutoff && audit.createdAt.getTime() <= now.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const latestBySource = new Map<string, ProviderEvidenceForDrift>();
  for (const audit of matchingAudits) {
    for (const evidence of evidenceFromAudit(audit)) {
      if (latestBySource.has(evidence.source)) continue;
      const asOf = Date.parse(evidence.asOf);
      if (
        evidence.windowDays !== windowDays ||
        !Number.isFinite(asOf) ||
        asOf < cutoff ||
        asOf > now.getTime()
      ) continue;
      latestBySource.set(evidence.source, evidence);
    }
  }
  return [...latestBySource.values()].sort((a, b) => a.source.localeCompare(b.source));
}

function evidenceFromAudit(audit: CompAuditForDrift): ProviderEvidenceForDrift[] {
  const candidates = [auditEvidence(audit), ...receiptEvidence(audit.receipt, audit.createdAt)];
  return candidates.filter((candidate): candidate is ProviderEvidenceForDrift => Boolean(
    candidate &&
      !NON_PROVIDER_SOURCES.has(candidate.source) &&
      candidate.medianPence > 0 &&
      candidate.sampleSize > 0,
  ));
}

function auditEvidence(audit: CompAuditForDrift): ProviderEvidenceForDrift | null {
  if (!audit.source || !Number.isFinite(audit.medianPence) || !Number.isFinite(audit.sampleSize)) return null;
  return {
    source: audit.source.trim(),
    medianPence: Math.round(audit.medianPence),
    sampleSize: Math.round(audit.sampleSize),
    windowDays: Math.round(audit.windowDays),
    asOf: audit.asOf.toISOString(),
    recordedAt: audit.createdAt.toISOString(),
  };
}

function receiptEvidence(receipt: unknown, recordedAt: Date): ProviderEvidenceForDrift[] {
  if (!receipt || typeof receipt !== "object") return [];
  const all = "all" in receipt ? (receipt as { all?: unknown }).all : null;
  if (!Array.isArray(all)) return [];
  return all.map((value) => readProviderEvidence(value, recordedAt)).filter((value): value is ProviderEvidenceForDrift => Boolean(value));
}

function readProviderEvidence(value: unknown, recordedAt: Date): ProviderEvidenceForDrift | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const source = typeof row.source === "string" ? row.source.trim() : "";
  const medianPence = Number(row.medianPence);
  const sampleSize = Number(row.sampleSize);
  const windowDays = Number(row.windowDays);
  const asOf = typeof row.asOf === "string" ? row.asOf : "";
  if (!source || !Number.isFinite(medianPence) || !Number.isFinite(sampleSize) || !Number.isFinite(windowDays) || !asOf) return null;
  return {
    source,
    medianPence: Math.round(medianPence),
    sampleSize: Math.round(sampleSize),
    windowDays: Math.round(windowDays),
    asOf,
    recordedAt: recordedAt.toISOString(),
  };
}
