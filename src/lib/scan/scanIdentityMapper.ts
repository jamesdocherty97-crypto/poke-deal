import { getAllSets, getSetById, resolveExactSetId, resolveSetIdForCard } from "../catalog/setCatalog.js";
import type { CatalogCard } from "../catalog/types.js";
import { normalizeCollectorNumberForCompare } from "../cards/identity.js";
import {
  GRADE_VALUES,
  type CardFinish,
  type Grade,
  type Language,
  type PrintEdition,
} from "../domain/types.js";
import type { ScanIdentity } from "./cardScan.js";

export interface ScanCompQuery {
  name: string;
  setName: string;
  number: string;
  grade: Grade;
  language: Language;
  edition?: PrintEdition;
  finish?: CardFinish;
  tcgApiId?: string;
  tcgDexId?: string;
  cardmarketId?: string;
  psaCert?: string;
}

export type ScanPrintIdentityResolution = {
  edition?: PrintEdition;
  finish?: CardFinish;
  unsupportedHints: string[];
  conflicts: string[];
};

const EDITION_SENSITIVE_EN_SET_IDS = new Set([
  "base1",
  "base2",
  "base3",
  "base5",
  "gym1",
  "gym2",
  "neo1",
  "neo2",
  "neo3",
  "neo4",
]);

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
  const name = cleanPrintedName(identity.name);
  const number = normalizePrintedNumber(identity.number);
  const setName = resolveScannedSetName(identity.setName, identity.setCode, number);
  const grade = canonicalGrade(identity.grader, identity.grade) ?? "RAW";
  const language = canonicalScanLanguage(identity.language, [identity.name, identity.setName, identity.notes].filter(Boolean).join(" "));
  const printIdentity = resolveScanPrintIdentity(identity);
  const warnings = scanWarnings(identity);
  const quickFill = buildScanQuickFill({
    name,
    setName,
    number,
    grade,
    language,
    edition: printIdentity.edition,
    finish: printIdentity.finish,
    certNumber: identity.certNumber,
    identityHints: [...identity.stamps, ...(identity.unresolvedIdentityHints ?? [])],
  });

  if (!identity.readable) {
    return {
      status: "manual",
      reason: looksLikeNonCard(identity) ? "That does not look like a Pokémon card." : "Couldn't read it — retake or type.",
      quickFill,
      warnings,
    };
  }

  if (!language) {
    return {
      status: "manual",
      reason: scanLanguageFailureReason(identity),
      quickFill,
      warnings,
    };
  }

  if (printIdentity.conflicts.length > 0 || printIdentity.unsupportedHints.length > 0) {
    return {
      status: "manual",
      reason: printIdentity.conflicts[0] ?? `Unsupported print identity: ${printIdentity.unsupportedHints.join(", ")}. Choose the exact printing before comping.`,
      quickFill,
      warnings,
    };
  }

  const query: ScanCompQuery = {
    name: addScanPrintHints(name, printIdentity, language),
    setName,
    number,
    grade,
    language,
    ...(printIdentity.edition ? { edition: printIdentity.edition } : {}),
    ...(printIdentity.finish ? { finish: printIdentity.finish } : {}),
    ...(nonBlank(identity.tcgApiId) ? { tcgApiId: identity.tcgApiId!.trim() } : {}),
    ...(nonBlank(identity.tcgDexId) ? { tcgDexId: identity.tcgDexId!.trim() } : {}),
    ...(nonBlank(identity.cardmarketId) ? { cardmarketId: identity.cardmarketId!.trim() } : {}),
  };

  if (identity.isSlab) {
    const grader = normalizeGrader(identity.grader);
    if (grader === "PSA" && identity.certNumber?.trim()) {
      return {
        status: "psa-cert",
        certNumber: identity.certNumber.trim(),
        query: { ...query, psaCert: identity.certNumber.trim() },
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

  if (language === "JP" && !setName && !hasExactProviderIdentity(query)) {
    return {
      status: "manual",
      reason: "Japanese scan needs a readable set name/code or an exact provider card identity before comping.",
      quickFill,
      warnings,
    };
  }

  if (requiresEditionConfirmation(setName, number, language) && !query.edition) {
    return {
      status: "manual",
      reason: "Edition is not confirmed for this vintage set. Choose Unlimited, 1st Edition, or Shadowless where applicable before comping.",
      quickFill,
      warnings,
    };
  }

  if (identity.isSlab) {
    const grader = normalizeGrader(identity.grader);
    if (grader && grade !== "RAW") {
      return {
        status: "confirm-slab",
        query,
        grader,
        gradeLabel: grade.replace(/_/g, " "),
        quickFill,
        warnings,
      };
    }
  }

  const alternatives = (options.alternatives ?? []).filter((card) =>
    card.language === language && catalogCandidateMatchesPrint(card, query),
  );
  if (!hasExactProviderIdentity(query) && !setName && alternatives.length > 1) {
    return { status: "ambiguous", query, alternatives, quickFill, warnings };
  }

  return {
    status: "ready",
    query,
    quickFill,
    warnings,
    needsAmbiguityCheck: Boolean(language === "EN" && !hasExactProviderIdentity(query) && !setName && name && number),
  };
}

export function scanWarnings(identity: ScanIdentity): string[] {
  const printIdentity = resolveScanPrintIdentity(identity);
  const language = canonicalScanLanguage(identity.language, [identity.name, identity.setName, identity.notes].filter(Boolean).join(" "));
  const warnings: string[] = [];
  if (language === "JP") warnings.push("Japanese identity read — English-market providers will be excluded.");
  if (printIdentity.edition) warnings.push(`${editionLabel(printIdentity.edition)} identity read — comp locked to that edition.`);
  if (printIdentity.finish) warnings.push(`${finishLabel(printIdentity.finish)} finish read — comp locked to that finish.`);
  warnings.push(...printIdentity.conflicts);
  if (printIdentity.unsupportedHints.length > 0) {
    warnings.push(`Unsupported print identity: ${printIdentity.unsupportedHints.join(", ")}.`);
  }
  return [...new Set(warnings)];
}

export function resolveScanPrintIdentity(identity: ScanIdentity): ScanPrintIdentityResolution {
  const editionCandidates = new Set<PrintEdition>();
  const finishCandidates = new Set<CardFinish>();
  const unsupportedHints = new Set(
    (identity.unresolvedIdentityHints ?? []).map((hint) => hint.trim()).filter(Boolean),
  );
  const identityText = [identity.name, identity.setName, identity.number].filter(Boolean).join(" ");
  const marks = [identity.edition, identity.finish, identityText, ...identity.stamps]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const mark of marks) {
    for (const edition of detectScanEditions(mark)) editionCandidates.add(edition);
    for (const finish of detectScanFinishes(mark)) finishCandidates.add(finish);
  }

  for (const stamp of identity.stamps) {
    const value = stamp.trim();
    if (value && isUnsupportedIdentityMark(value)) unsupportedHints.add(value);
  }

  const conflicts: string[] = [];
  if (editionCandidates.size > 1) {
    conflicts.push(`Conflicting edition marks (${[...editionCandidates].map(editionLabel).join(" and ")}) need exact-print confirmation.`);
  }
  if (finishCandidates.size > 1) {
    conflicts.push(`Conflicting finishes (${[...finishCandidates].map(finishLabel).join(" and ")}) need exact-print confirmation.`);
  }

  return {
    ...((editionCandidates.size === 1) ? { edition: [...editionCandidates][0]! } : {}),
    ...((finishCandidates.size === 1) ? { finish: [...finishCandidates][0]! } : {}),
    unsupportedHints: [...unsupportedHints],
    conflicts,
  };
}

export function canonicalScanLanguage(
  value: string | null | undefined,
  printedText = "",
): Language | null {
  const normalized = value?.trim().toLowerCase();
  const japaneseScript = /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u.test(printedText);
  if (["ja", "jp", "jpn", "japanese", "日本語"].includes(normalized ?? "")) return "JP";
  if (["en", "eng", "english"].includes(normalized ?? "")) return japaneseScript ? null : "EN";
  if ((!normalized || ["unknown", "undetermined", "unreadable"].includes(normalized)) && japaneseScript) return "JP";
  return null;
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

  return normalizeCollectorNumberForCompare(cleaned) ?? cleaned.toUpperCase().replace(/^0+(\d)/, "$1");
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
    .replace(/\b(?:EN|ENG|ENGLISH|JA|JP|JPN|JAPANESE)\b/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function scanLanguageFailureReason(identity: ScanIdentity): string {
  const value = identity.language?.trim();
  const printedText = [identity.name, identity.setName, identity.notes].filter(Boolean).join(" ");
  if (/\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u.test(printedText) && /^(?:en|eng|english)$/i.test(value ?? "")) {
    return "Printed Japanese text conflicts with the reported English language. Confirm the card language before comping.";
  }
  if (!value || /^(?:unknown|undetermined|unreadable)$/i.test(value)) {
    return "Card language was not confirmed. Choose English or Japanese before comping.";
  }
  return `${value} scan is not supported by the current comp providers. Keep the language explicit and use manual comp.`;
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
  language: Language | null;
  edition?: PrintEdition;
  finish?: CardFinish;
  certNumber?: string | null;
  identityHints: string[];
}): string {
  const supportedHints = new Set<string>();
  if (input.edition) supportedHints.add(editionLabel(input.edition));
  if (input.finish) supportedHints.add(finishLabel(input.finish));
  const unresolvedHints = input.identityHints
    .map((hint) => hint.trim())
    .filter((hint) => {
      if (!hint) return false;
      const editions = detectScanEditions(hint);
      const finishes = detectScanFinishes(hint);
      if (editions.length > 0 && !input.edition) return true;
      if (finishes.length > 0 && !input.finish) return true;
      return editions.length === 0 && finishes.length === 0;
    });
  return [
    input.name,
    input.setName,
    input.number,
    ...supportedHints,
    input.language === "JP" ? "JP" : null,
    input.grade === "RAW" ? "RAW" : input.grade.replace(/_/g, " "),
    input.certNumber ? `cert ${input.certNumber.trim()}` : null,
    ...unresolvedHints,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function detectScanEditions(value: string): PrintEdition[] {
  const text = value.toLowerCase().replace(/_/g, " ");
  const values: PrintEdition[] = [];
  if (/\b(?:1st|first)\s*(?:edition|ed)\b/.test(text)) values.push("FIRST_EDITION");
  if (/\bshadowless\b/.test(text)) values.push("SHADOWLESS");
  if (/\bstaff\b/.test(text)) values.push("STAFF");
  if (/\bpre[\s-]?release\b/.test(text)) values.push("PRERELEASE");
  if (/\bunlimited\b/.test(text)) values.push("UNLIMITED");
  return values;
}

function detectScanFinishes(value: string): CardFinish[] {
  const text = value.toLowerCase().replace(/_/g, " ");
  if (/\breverse[\s-]?holo(?:foil)?\b/.test(text)) return ["REVERSE_HOLO"];
  if (/\b(?:non[\s-]?holo(?:foil)?|normal)\b/.test(text)) return ["NORMAL"];
  if (/\bholo(?:foil)?\b/.test(text)) return ["HOLO"];
  return [];
}

function isUnsupportedIdentityMark(value: string): boolean {
  const text = value.toLowerCase();
  if (/\b(?:cosmos|galaxy|cracked\s+ice|mirror|master\s*ball|poke\s*ball|pok[eé]\s*ball|holo\s*bleed|winner|league|pokemon\s*center|error|misprint|w\s*stamp)\b/.test(text)) {
    return true;
  }
  const looksIdentityBearing = /\b(?:edition|shadowless|staff|pre[\s-]?release|unlimited|holo|foil|finish|stamp)\b/.test(text);
  return looksIdentityBearing && detectScanEditions(value).length === 0 && detectScanFinishes(value).length === 0;
}

function editionLabel(value: PrintEdition): string {
  if (value === "FIRST_EDITION") return "1st Edition";
  if (value === "SHADOWLESS") return "Shadowless";
  if (value === "STAFF") return "Staff";
  if (value === "PRERELEASE") return "Prerelease";
  return "Unlimited";
}

function finishLabel(value: CardFinish): string {
  if (value === "REVERSE_HOLO") return "Reverse Holo";
  if (value === "HOLO") return "Holofoil";
  return "Normal";
}

function addScanPrintHints(
  name: string,
  identity: Pick<ScanPrintIdentityResolution, "edition" | "finish">,
  language: Language,
): string {
  if (language === "JP") return name;
  let value = name;
  if (identity.edition && !detectScanEditions(value).includes(identity.edition)) {
    value = `${value} ${editionLabel(identity.edition)}`.trim();
  }
  if (identity.finish && !detectScanFinishes(value).includes(identity.finish)) {
    value = `${value} ${finishLabel(identity.finish)}`.trim();
  }
  return value;
}

function hasExactProviderIdentity(query: ScanCompQuery): boolean {
  return Boolean(query.tcgApiId || query.tcgDexId || query.cardmarketId);
}

function catalogCandidateMatchesPrint(card: CatalogCard, query: ScanCompQuery): boolean {
  if (query.edition && card.edition && query.edition !== card.edition) return false;
  if (query.finish && card.finish && query.finish !== card.finish) return false;
  return true;
}

function requiresEditionConfirmation(setName: string, number: string, language: Language): boolean {
  if (language !== "EN" || !setName) return false;
  const setId = resolveSetIdForCard(setName, number);
  return Boolean(setId && EDITION_SENSITIVE_EN_SET_IDS.has(setId));
}

function nonBlank(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}
