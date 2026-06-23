import { getSetById, searchSets, resolveSetIdForCard } from "../catalog/setCatalog.js";
import { normalizeSearchText, tokenizeSearchText, tokenMatches } from "../catalog/fuzzy.js";

export type ParsedQuickIntakeGrade = "RAW" | "PSA_9" | "PSA_10" | "BGS_9_5" | "CGC_10";

export interface ParsedQuickIntake {
  name?: string;
  setName?: string;
  number?: string;
  grade?: ParsedQuickIntakeGrade;
  cost?: string;
  quantity?: string;
}

interface SetMatch {
  setName: string;
  phrase: string;
  score: number;
}

const NUMBER_PATTERNS = [
  /\b(?:TG|GG|SVP|SWSH|SM|XY|BW|DP|HGSS|SV)\s*0?\d{1,3}\s*\/\s*(?:TG|GG|SV)?\s*0?\d{1,3}\b/i,
  /\b\d{1,3}\s*\/\s*\d{1,3}\b/i,
  /\b(?:TG|GG|SVP|SWSH|SM|XY|BW|DP|HGSS|SV)\s*0?\d{1,3}\b/i,
];

const GRADE_PATTERNS: Array<{ grade: ParsedQuickIntakeGrade; pattern: RegExp }> = [
  { grade: "BGS_9_5", pattern: /\bbgs\s*9(?:\.|,)?5\b/i },
  { grade: "CGC_10", pattern: /\bcgc\s*10\b/i },
  { grade: "PSA_10", pattern: /\bpsa\s*10\b/i },
  { grade: "PSA_9", pattern: /\bpsa\s*9\b/i },
  { grade: "RAW", pattern: /\b(?:raw|ungraded|nm|near mint)\b/i },
];

const STRONG_SET_ALIASES = new Set([
  "151",
  "base set",
  "cz",
  "cz gg",
  "crown zenith gg",
  "evo skies",
  "evoskies",
  "lor tg",
  "lost origin tg",
  "brs tg",
  "brilliant stars tg",
  "asr tg",
  "astral radiance tg",
  "sit tg",
  "silver tempest tg",
  "hif sv",
  "hidden fates sv",
  "shf sv",
  "shining fates sv",
  "pris evo",
  "pris evos",
  "prismatic",
  "prismatic evo",
  "prismatic evos",
  "sv promos",
  "swsh promos",
  "wotc promos",
]);

export function parseQuickIntake(input: string): ParsedQuickIntake {
  let working = normalizeSpacing(input);
  const parsed: ParsedQuickIntake = {};

  const cost = extractCost(working);
  if (cost) {
    parsed.cost = cost.value;
    working = removeMatch(working, cost.match);
  }

  const quantity = extractQuantity(working);
  if (quantity) {
    parsed.quantity = String(quantity.value);
    working = removeMatch(working, quantity.match);
  }

  const grade = extractGrade(working);
  if (grade) {
    parsed.grade = grade.value;
    working = removeMatch(working, grade.match);
  }

  const number = extractNumber(working);
  if (number) {
    parsed.number = normalizeCollectorNumber(number.value);
    working = removeMatch(working, number.match);
  }

  const setMatch = findSetMatch(working, parsed.number);
  if (setMatch) {
    parsed.setName = setMatch.setName;
    working = removePhrase(working, setMatch.phrase);
  }

  const name = cleanupName(working);
  if (name) parsed.name = name;

  return parsed;
}

function extractCost(input: string): { value: string; match: string } | null {
  const match =
    input.match(/(?:£\s*)(\d+(?:[.,]\d{1,2})?)/i) ??
    input.match(/\b(?:paid|cost|buy|bought)\s*(?:£\s*)?(\d+(?:[.,]\d{1,2})?)\b/i);
  if (!match?.[1]) return null;
  return { value: formatMoney(match[1]), match: match[0] };
}

function extractQuantity(input: string): { value: number; match: string } | null {
  const match =
    input.match(/(?:^|\s)(?:qty|quantity)\s*(\d{1,3})(?=\s|$)/i) ??
    input.match(/(?:^|\s)x\s*(\d{1,3})(?=\s|$)/i) ??
    input.match(/(?:^|\s)(\d{1,3})\s*x(?=\s|$)/i);
  if (!match?.[0]) return null;
  const value = match?.[1] ? Number(match[1]) : 0;
  if (!Number.isInteger(value) || value <= 0) return null;
  return { value, match: match[0] };
}

function extractGrade(input: string): { value: ParsedQuickIntakeGrade; match: string } | null {
  for (const option of GRADE_PATTERNS) {
    const match = input.match(option.pattern);
    if (match?.[0]) return { value: option.grade, match: match[0] };
  }
  return null;
}

function extractNumber(input: string): { value: string; match: string } | null {
  for (const pattern of NUMBER_PATTERNS) {
    const match = input.match(pattern);
    if (match?.[0]) return { value: match[0], match: match[0] };
  }
  return null;
}

function findSetMatch(input: string, number: string | undefined): SetMatch | null {
  const words = input.split(/\s+/).filter(Boolean);
  let best: SetMatch | null = null;

  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 1; end <= Math.min(words.length, start + 5); end += 1) {
      const phrase = words.slice(start, end).join(" ");
      if (!isUsefulSetPhrase(phrase)) continue;
      const set = searchSets(phrase, 1)[0];
      if (!set) continue;

      const resolvedId = resolveSetIdForCard(set.name, number) ?? set.id;
      const resolved = getSetById(resolvedId) ?? set;
      const score = scoreSetPhrase(phrase, set);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { setName: resolved.name, phrase, score };
      }
    }
  }

  return best;
}

function isUsefulSetPhrase(phrase: string): boolean {
  const normalized = phrase.trim().toLowerCase();
  if (normalized.length >= 3) return true;
  return ["bs", "cz", "gg"].includes(normalized);
}

function scoreSetPhrase(phrase: string, set: { id: string; name: string; ptcgoCode?: string }): number {
  const normalizedPhrase = normalizeSearchText(phrase);
  const normalizedSet = normalizeSearchText(set.name);
  if (
    normalizedPhrase === set.id.toLowerCase() ||
    normalizedPhrase === set.ptcgoCode?.toLowerCase()
  ) {
    return 1000;
  }
  if (STRONG_SET_ALIASES.has(normalizedPhrase)) return 950 + tokenizeSearchText(phrase).length;
  if (normalizedPhrase === normalizedSet) return 900 + tokenizeSearchText(phrase).length;

  const phraseTokens = tokenizeSearchText(phrase);
  const setTokens = tokenizeSearchText(set.name);
  const matchedSet = setTokens.every((setToken) =>
    phraseTokens.some((phraseToken) => tokenMatches(phraseToken, setToken)),
  );
  if (matchedSet) {
    const extraTokens = phraseTokens.filter(
      (phraseToken) => !setTokens.some((setToken) => tokenMatches(phraseToken, setToken)),
    ).length;
    return 850 + setTokens.length * 10 - extraTokens * 220;
  }

  return 0;
}

function normalizeCollectorNumber(value: string): string {
  return value
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, "")
    .replace(/^([a-z]+)/i, (prefix) => prefix.toUpperCase())
    .replace(/\/([a-z]+)/i, (_, prefix: string) => `/${prefix.toUpperCase()}`);
}

function formatMoney(value: string): string {
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return amount.toFixed(2);
}

function removeMatch(input: string, match: string): string {
  return normalizeSpacing(input.replace(match, " "));
}

function removePhrase(input: string, phrase: string): string {
  return normalizeSpacing(input.replace(new RegExp(escapeRegExp(phrase), "i"), " "));
}

function cleanupName(input: string): string {
  return normalizeSpacing(
    input
      .replace(/[()|,;]+/g, " ")
      .replace(/\b(?:card|pokemon|pokémon)\b/gi, " "),
  );
}

function normalizeSpacing(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
