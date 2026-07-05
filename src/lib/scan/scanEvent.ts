import type { Prisma } from "@prisma/client";
import { getPrisma } from "../db/prisma.js";
import type { Grade, Language } from "../domain/types.js";
import type { ScanIdentity, ScanResult } from "./cardScan.js";
import { canonicalGrade } from "./scanIdentityMapper.js";

export type ScanEventStatus = "READABLE" | "UNREADABLE" | "ERROR";

export interface ScanEventData {
  source: string;
  status: ScanEventStatus;
  name?: string;
  setName?: string;
  setCode?: string;
  number?: string;
  language?: Language;
  grade?: Grade;
  model?: string;
  raw?: Prisma.InputJsonValue;
}

export function scanEventDataFromResult(result: ScanResult, source = "gemini-scan"): ScanEventData {
  const identity = result.identity;
  return compactScanEventData({
    source,
    status: identity.readable ? "READABLE" : "UNREADABLE",
    name: identity.name ?? undefined,
    setName: identity.setName ?? undefined,
    setCode: identity.setCode ?? undefined,
    number: identity.number ?? undefined,
    language: scanLanguage(identity.language),
    grade: scanGrade(identity),
    model: result.model,
    raw: { identity } as unknown as Prisma.InputJsonValue,
  });
}

export function scanEventDataFromError(error: unknown, source = "gemini-scan"): ScanEventData {
  const raw: Record<string, string> = {
    message: error instanceof Error ? error.message : "unknown scan error",
  };
  if (typeof error === "object" && error && "kind" in error) raw.kind = String((error as { kind?: unknown }).kind);
  return {
    source,
    status: "ERROR",
    raw: raw as Prisma.InputJsonValue,
  };
}

export async function logScanEvent(data: ScanEventData): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await getPrisma().scanEvent.create({ data }).catch((err) => {
    console.warn("[scan] event persistence skipped:", err instanceof Error ? err.message : "unknown");
  });
}

function compactScanEventData(data: ScanEventData): ScanEventData {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as ScanEventData;
}

function scanGrade(identity: ScanIdentity): Grade | undefined {
  if (!identity.isSlab) return "RAW";
  return canonicalGrade(identity.grader, identity.grade) ?? undefined;
}

function scanLanguage(language: string | null | undefined): Language | undefined {
  const value = language?.trim().toLowerCase();
  if (!value) return undefined;
  if (value.startsWith("jp") || value.startsWith("ja")) return "JP";
  if (value.startsWith("en") || value.includes("english")) return "EN";
  return undefined;
}
