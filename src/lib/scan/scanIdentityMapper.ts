import { getAllSets, getSetById, resolveExactSetId, resolveSetIdForCard } from "../catalog/setCatalog.js";
import type { CatalogCard } from "../catalog/types.js";
import { GRADE_VALUES, type Grade } from "../domain/types.js";
import type { ScanIdentity } from "./cardScan.js";

export interface ScanCompQuery {
  name: string;
  setName: string;
  number: string;
  grade: Grade;
  psaCert?: string;
}

export type ScanIdentityMapping =
  | {
      status: "ready";
      query: ScanCompQuery;
      quickFill: string;
      warnings: string[];
      needsAmbiguityCheck: boolean;
    }
  | {
      status: "psa-cert";
      certNumber: string;
      query: ScanCompQuery;
      quickFill: string;
      warnings: string[];
    }
  | {
      status: "confirm-slab";
      query: ScanCompQuery;
      grader: string;
      gradeLabel: string;
      quickFill: string;
      warnings: string[];
    }
  | {
      status: "ambiguous";
      query: ScanCompQuery;
      alternatives: CatalogCard[];
      quickFill: string;
      warnings: string[];
    }
  | {
      status: "manual";
      reason: string;
      quickFill: string;
      warnings: string[];
    };

export function scanIdentityToQuery(
  identity: ScanIdentity,
  options: { alternatives?: CatalogCard[] } = {},
): ScanIdentityMapping {
  const warnings = scanWarnings(identity);
  const name = cleanPrintedName(identity.name);
  const number = normalizePrintedNumber(identity.number);
  const setName = resolveScannedSetName(identity.setName, identity.setCode, number);
  const grade = canonicalGrade(identity.grader, identity.grade) ?? "RAW";
  const quickFill = buildScanQuickFill({ name, setName, number, grade, certNumber: identity.certNumber, warnings });

  if (isNonEnglish(identity.language)) {
    return { status: "manual", reason: "Non-English scan — use manual comp for now.", quickFill, warnings };
  }

  if (!identity.readable) {
    return {
      status: "manual",
      reason: looksLikeNonCard(identity) ? "That does not look like a Pokémon card." : "Couldn't read it — retake or type.",
      quickFill,
      warnings,
    };
  }

  if (identity.isSlab) {
    const grader = normalizeGrader(identity.grader);
    if (grader === "PSA" && identity.certNumber?.trim()) {
      return {
        status: "psa-cert",
        certNumber: identity.certNumber.trim(),
        query: { name, setName, number, grade, psaCert: identity.certNumber.trim() },
        quickFill,
        warnings,
      };
    }
    if (grader && grade !== "RAW") {
      return {
        status: "confirm-slab",
        query: { name, setName, number, grade },
        grader,
        gradeLabel: grade.replace(/_/g, " "),
        quickFill,
        warnings,
      };
    }
  }

  if (!name) {
    return { status: "manual", reason: "Couldn't read the card name — retake or type.", quickFill, warnings };
  }
  if (!number) {
    return { status: "manual", reason: "Couldn't read the collector number — retake or type.", quickFill, warnings };
  }

  const query = { name, setName, number, grade };
  if (!setName && options.alternatives && options.alternatives.length > 1) {
    return { status: "ambiguous", query, alternatives: options.alternatives, quickFill, warnings };
  }

  return {
    status: "ready",
    query,
    quickFill,
    warnings,
    needsAmbiguityCheck: Boolean(!setName && name && number),
  };
}

export function scanWarnings(identity: ScanIdentity): string[] {
  const stamps = identity.stamps.map((stamp) => stamp.trim()).filter(Boolean);
  const stampText = stamps.join(" ");
  const warnings: string[] = [];
  if (/\b(?:1st|first)\s*(?:edition|ed)\b/i.test(stampText)) {
    warnings.push("1st Edition stamp read — comps may reflect unlimited printing, check manually.");
  }
  if (/\bshadowless\b/i.test(stampText)) {
    warnings.push("Shadowless stamp read — comps may reflect unlimited printing, check manually.");
  }
  return warnings;
}

export function canonicalGrade(grader: string | null | undefined, grade: string | null | undefined): Grade | null {
  const company = normalizeGrader(grader);
  if (!company || !grade?.trim()) return null;
  const numeric = grade
    .trim()
    .toUpperCase()
    .replace(/GEM\s*MT|MINT|NM-MT|NEAR\s*MINT|AUTHENTIC/g, "")
    .replace(/,/g, ".")
    .match(/10|[1-9](?:\s*\.\s*5)?|1(?:\s*\.\s*5)?/)?.[0]
    ?.replace(/\s+/g, "");
  if (!numeric) return null;
  const value = `${company}_${numeric.replace(".", "_")}` as Grade;
  return (GRADE_VALUES as readonly string[]).includes(value) ? value : null;
}

export function normalizePrintedNumber(value: string | null | undefined): string {
  const cleaned = value
    ?.trim()
    .replace(/\b(?:EN|ENG|ENGLISH)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .trim();
  if (!cleaned) return "";

  const promo = cleaned.match(/^(SVP|MEP|SWSH|SM|XY|BW|DP|HGSS)\s*0*(\d{1,4})$/i);
  if (promo) return `${promo[1]!.toUpperCase()} ${promo[2]!.padStart(3, "0")}`;

  const gallery = cleaned.match(/^(TG|GG)\s*0*(\d{1,3})(?:\/(TG|GG)?\s*0*(\d{1,3}))?$/i);
  if (gallery) {
    const prefix = gallery[1]!.toUpperCase();
    const left = `${prefix}${gallery[2]!.padStart(2, "0")}`;
    const right = gallery[4] ? `/${(gallery[3] ?? prefix).toUpperCase()}${gallery[4]!.padStart(2, "0")}` : "";
    return `${left}${right}`;
  }

  return cleaned.toUpperCase().replace(/^0+(\d)/, "$1");
}

function resolveScannedSetName(
  setName: string | null | undefined,
  setCode: string | null | undefined,
  number: string,
): string {
  const typedSet = stripLanguageTokens(setName ?? "");
  const code = stripLanguageTokens(setCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const codeSetId = code ? resolveExactSetId(code) ?? getAllSets().find((set) => set.ptcgoCode?.toUpperCase() === code)?.id : undefined;
  const normalizedNumber = number.replace(/\s+/g, "");
  const resolvedSetId = resolveSetIdForCard(typedSet || code, normalizedNumber);
  const set = getSetById(resolvedSetId ?? codeSetId ?? "");
  return set?.name ?? typedSet;
}

function cleanPrintedName(value: string | null | undefined): string {
  return stripLanguageTokens(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLanguageTokens(value: string): string {
  return value
    .replace(/\b(?:EN|ENG|ENGLISH)\b/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isNonEnglish(language: string | null | undefined): boolean {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return false;
  return !["en", "eng", "english"].includes(normalized);
}

function looksLikeNonCard(identity: ScanIdentity): boolean {
  const haystack = [identity.notes, identity.name, identity.setName].filter(Boolean).join(" ");
  return /\b(?:not\s+(?:a\s+)?(?:pokemon|card)|no\s+(?:pokemon|card)|receipt|box|person|poster)\b/i.test(haystack);
}

function normalizeGrader(value: string | null | undefined): "PSA" | "BGS" | "CGC" | "ACE" | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "PSA" || normalized === "BGS" || normalized === "CGC" || normalized === "ACE") return normalized;
  return null;
}

function buildScanQuickFill(input: {
  name: string;
  setName: string;
  number: string;
  grade: Grade;
  certNumber?: string | null;
  warnings: string[];
}): string {
  return [
    input.name,
    input.setName,
    input.number,
    input.grade === "RAW" ? "RAW" : input.grade.replace(/_/g, " "),
    input.certNumber ? `cert ${input.certNumber.trim()}` : null,
    input.warnings.some((warning) => /1st Edition/i.test(warning)) ? "1st Edition" : null,
    input.warnings.some((warning) => /Shadowless/i.test(warning)) ? "Shadowless" : null,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}
