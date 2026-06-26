import { getSetById, searchSets, resolveExactSetId, resolveSetIdForCard } from "../catalog/setCatalog.js";
import { normalizeSearchText, tokenizeSearchText, tokenMatches } from "../catalog/fuzzy.js";
import type { Grade } from "../domain/types.js";
import { splitTotalCostToUnitPence } from "./bundleCost.js";
import type { SaleChannel } from "./saleFees.js";

export type ParsedQuickIntakeGrade = Grade;
export type ParsedQuickIntakeChannel = SaleChannel;
export type ParsedQuickIntakeListingState = "DRAFT" | "ACTIVE";

export interface ParsedQuickIntake {
  name?: string;
  setName?: string;
  number?: string;
  grade?: ParsedQuickIntakeGrade;
  cost?: string;
  costMode?: "TOTAL_SPLIT";
  quantity?: string;
  source?: string;
  location?: string;
  condition?: string;
  graderCert?: string;
  channel?: ParsedQuickIntakeChannel;
  listingState?: ParsedQuickIntakeListingState;
}

interface SetMatch {
  setName: string;
  phrase: string;
  score: number;
}

interface CostMatch {
  value: string;
  match: string;
  isTotal: boolean;
}

const NUMBER_PATTERNS = [
  /\b(?:TG|GG|SVP|MEP|SWSH|SM|XY|BW|DP|HGSS|SV)\s*0?\d{1,4}\s*\/\s*(?:TG|GG|SV|MEP)?\s*0?\d{1,4}\b/i,
  /\b(?!SET\b)[A-Z]{2,5}\s*0?\d{1,4}\s*\/\s*[A-Z]{0,5}\s*0?\d{1,4}\b/i,
  /\b\d{1,3}\s*\/\s*\d{1,3}\b/i,
  /\b(?:TG|GG|SVP|MEP|SWSH|SM|XY|BW|DP|HGSS|SV)\s*0?\d{1,4}\b/i,
  /\b(?!SET\b)[A-Z]{2,5}\s*0?\d{1,4}\b/i,
];

const SUPPORTED_QUICK_GRADES = new Set<ParsedQuickIntakeGrade>([
  "RAW",
  "PSA_1",
  "PSA_2",
  "PSA_3",
  "PSA_4",
  "PSA_5",
  "PSA_6",
  "PSA_7",
  "PSA_8",
  "PSA_9",
  "PSA_10",
  "BGS_9",
  "BGS_9_5",
  "BGS_10",
  "CGC_9",
  "CGC_9_5",
  "CGC_10",
  "ACE_9",
  "ACE_10",
]);

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
  "mep",
  "mega evolution promos",
  "sv promos",
  "swsh promos",
  "wotc promos",
]);

export function parseQuickIntake(input: string): ParsedQuickIntake {
  let working = normalizeSpacing(input);
  const parsed: ParsedQuickIntake = {};

  const quantity = extractQuantity(working);
  if (quantity) {
    parsed.quantity = String(quantity.value);
    working = removeMatch(working, quantity.match);
  }

  const cost = extractCost(working);
  if (cost) {
    parsed.cost = cost.isTotal && quantity ? splitTotalCost(cost.value, quantity.value) : cost.value;
    if (cost.isTotal && quantity) parsed.costMode = "TOTAL_SPLIT";
    working = removeMatch(working, cost.match);
  }

  const listingChannel = extractListingChannel(working);
  if (listingChannel) {
    parsed.channel = listingChannel.value;
    working = removeMatch(working, listingChannel.match);
  }

  const listingState = extractListingState(working);
  if (listingState) {
    parsed.listingState = listingState.value;
    working = removeMatch(working, listingState.match);
  }

  const source = extractSource(working);
  if (source) {
    parsed.source = source.value;
    working = removeMatch(working, source.match);
  }

  const location = extractLocation(working);
  if (location) {
    parsed.location = location.value;
    working = removeMatch(working, location.match);
  }

  const condition = extractCondition(working);
  if (condition) {
    parsed.condition = condition.value;
    working = removeMatch(working, condition.match);
  }

  const grade = extractGrade(working);
  if (grade) {
    parsed.grade = grade.value;
    working = removeMatch(working, grade.match);
  }

  const cert = extractCert(working);
  if (cert) {
    parsed.graderCert = cert.value;
    working = removeMatch(working, cert.match);
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
  } else if (parsed.number) {
    const inferredSetName = inferSetNameFromCollectorNumber(parsed.number);
    if (inferredSetName) {
      parsed.setName = inferredSetName;
    }
  }

  const name = cleanupName(working);
  if (name) parsed.name = name;

  return parsed;
}

function extractCost(input: string): CostMatch | null {
  const totalMatch =
    input.match(/\b(?:paid|cost|buy|bought)?\s*(?:total|bundle|job\s*lot|lot)\s*(?:price|cost|paid|for)?\s*(?:£\s*)?(\d+(?:[.,]\d{1,2})?)\b/i) ??
    input.match(/\b(?:paid|cost|buy|bought)\s*(?:£\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:total|all\s*in|for\s*(?:both|all|the\s+lot)|bundle|job\s*lot|lot)\b/i) ??
    input.match(/(?:£\s*)(\d+(?:[.,]\d{1,2})?)\s*(?:total|all\s*in|for\s*(?:both|all|the\s+lot)|bundle|job\s*lot|lot)\b/i) ??
    input.match(/\bfor\s*(?:£\s*)?(\d+(?:[.,]\d{1,2})?)\b/i);
  if (totalMatch?.[1]) return { value: formatMoney(totalMatch[1]), match: totalMatch[0], isTotal: true };

  const match =
    input.match(/(?:£\s*)(\d+(?:[.,]\d{1,2})?)/i) ??
    input.match(/\b(?:paid|cost|buy|bought)\s*(?:£\s*)?(\d+(?:[.,]\d{1,2})?)\b/i);
  if (!match?.[1]) return null;
  return { value: formatMoney(match[1]), match: match[0], isTotal: false };
}

function extractQuantity(input: string): { value: number; match: string } | null {
  const match =
    input.match(/(?:^|\s)(\d{1,3})(?=\s+for\s+(?:£\s*)?\d)/i) ??
    input.match(/(?:^|\s)(?:qty|quantity)\s*(\d{1,3})(?=\s|$)/i) ??
    input.match(/(?:^|\s)x\s*(\d{1,3})(?=\s|$)/i) ??
    input.match(/(?:^|\s)(\d{1,3})\s*x(?=\s|$)/i);
  if (!match?.[0]) return null;
  const value = match?.[1] ? Number(match[1]) : 0;
  if (!Number.isInteger(value) || value <= 0) return null;
  return { value, match: match[0] };
}

function extractSource(input: string): { value: string; match: string } | null {
  return firstPresetMatch(input, [
    { value: "Card fair", pattern: /\b(?:from\s+|via\s+|at\s+)?card\s+fair\b/i },
    { value: "Facebook", pattern: /\b(?:from\s+|via\s+)?(?:facebook|fb)\b/i },
    { value: "eBay", pattern: /\b(?:from\s+|via\s+)?ebay\b/i },
    { value: "Cardmarket", pattern: /\b(?:from\s+|via\s+)?cardmarket\b/i },
    { value: "Vinted", pattern: /\b(?:from\s+|via\s+)?vinted\b/i },
    { value: "Whatnot", pattern: /\b(?:from\s+|via\s+)?whatnot\b/i },
    { value: "Collection", pattern: /\b(?:from\s+)?collection\b/i },
    { value: "Trade-in", pattern: /\btrade[\s-]?in\b/i },
  ]);
}

function extractListingChannel(input: string): { value: ParsedQuickIntakeChannel; match: string } | null {
  return firstPresetMatch(input, [
    { value: "EBAY", pattern: /\b(?:list|listing|sell|selling|post|post\s+on|channel)\s+(?:on\s+|to\s+|via\s+)?ebay\b/i },
    { value: "CARDMARKET", pattern: /\b(?:list|listing|sell|selling|post|post\s+on|channel)\s+(?:on\s+|to\s+|via\s+)?cardmarket\b/i },
    { value: "VINTED", pattern: /\b(?:list|listing|sell|selling|post|post\s+on|channel)\s+(?:on\s+|to\s+|via\s+)?vinted\b/i },
    { value: "IN_PERSON", pattern: /\b(?:sell|selling|channel)\s+(?:in\s+person|cash|at\s+show|at\s+fair)\b/i },
    { value: "EBAY", pattern: /\bebay\s+(?:draft|active|listing|offer)\b/i },
    { value: "CARDMARKET", pattern: /\bcardmarket\s+(?:draft|active|listing)\b/i },
    { value: "VINTED", pattern: /\bvinted\s+(?:draft|active|listing)\b/i },
  ]);
}

function extractListingState(input: string): { value: ParsedQuickIntakeListingState; match: string } | null {
  return firstPresetMatch(input, [
    { value: "ACTIVE", pattern: /\b(?:active|listed|live)\s*(?:listing)?\b/i },
    { value: "DRAFT", pattern: /\b(?:draft|drafted)\s*(?:listing)?\b/i },
  ]);
}

function extractLocation(input: string): { value: string; match: string } | null {
  return firstPresetMatch(input, [
    { value: "Box A", pattern: /\bbox\s*a\b/i },
    { value: "Box B", pattern: /\bbox\s*b\b/i },
    { value: "Binder", pattern: /\bbinder\b/i },
    { value: "To list", pattern: /\bto\s+list\b/i },
    { value: "Slabs", pattern: /\bslabs?\b/i },
    { value: "Singles", pattern: /\bsingles?\b/i },
  ]);
}

function extractCondition(input: string): { value: string; match: string } | null {
  return firstPresetMatch(input, [
    { value: "NM", pattern: /\b(?:near\s*mint|nm)\b/i },
    { value: "LP", pattern: /\b(?:light(?:ly)?\s*played|light\s*play|lp)\b/i },
    { value: "MP", pattern: /\b(?:moderately\s*played|moderate\s*play|mod\s*play|mp)\b/i },
    { value: "HP", pattern: /\b(?:heavily\s*played|heavy\s*play|hp)\b/i },
    { value: "DMG", pattern: /\b(?:damaged|damage|dmg)\b/i },
  ]);
}

function extractGrade(input: string): { value: ParsedQuickIntakeGrade; match: string } | null {
  const slab = input.match(/\b(PSA|BGS|CGC|ACE)\s*(10|9(?:[.,]5)?|[1-8])\b/i);
  if (slab?.[0] && slab[1] && slab[2]) {
    const company = slab[1].toUpperCase();
    const numeric = slab[2].replace(",", ".").replace(".", "_");
    const grade = `${company}_${numeric}` as ParsedQuickIntakeGrade;
    if (SUPPORTED_QUICK_GRADES.has(grade)) return { value: grade, match: slab[0] };
  }

  const raw = input.match(/\b(?:raw|ungraded|nm|near mint)\b/i);
  if (raw?.[0]) return { value: "RAW", match: raw[0] };

  return null;
}

function extractCert(input: string): { value: string; match: string } | null {
  const match = input.match(/\b(?:(?:psa|bgs|cgc|ace)\s+)?cert(?:ificate)?(?:\s*(?:no|number|#))?\s*#?\s*([A-Z0-9-]{4,})\b/i);
  if (!match?.[0] || !match[1]) return null;
  return { value: match[1].toUpperCase(), match: match[0] };
}

function firstPresetMatch<T extends string>(
  input: string,
  options: Array<{ value: T; pattern: RegExp }>,
): { value: T; match: string } | null {
  for (const option of options) {
    const match = input.match(option.pattern);
    if (match?.[0]) return { value: option.value, match: match[0] };
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
  if (STRONG_SET_ALIASES.has(normalizedPhrase)) return 1200 + tokenizeSearchText(phrase).length;
  if (
    normalizedPhrase === set.id.toLowerCase() ||
    normalizedPhrase === set.ptcgoCode?.toLowerCase()
  ) {
    return 1000;
  }
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

function inferSetNameFromCollectorNumber(number: string): string | undefined {
  const prefix = number.match(/^([A-Z]{2,5})\d{1,4}/)?.[1];
  if (!prefix) return undefined;
  const setId = resolveExactSetId(prefix);
  return setId ? getSetById(setId)?.name : undefined;
}

function formatMoney(value: string): string {
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return amount.toFixed(2);
}

function splitTotalCost(value: string, quantity: number): string {
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return value;
  const split = splitTotalCostToUnitPence(Math.round(amount * 100), quantity);
  return split ? formatPence(split.unitCostPence) : value;
}

function formatPence(pence: number): string {
  return (pence / 100).toFixed(2);
}

function removeMatch(input: string, match: string): string {
  return normalizeSpacing(input.replace(match, " "));
}

function removePhrase(input: string, phrase: string): string {
  return normalizeSpacing(input.replace(new RegExp(escapeRegExp(phrase), "i"), " "));
}

function cleanupName(input: string): string {
  const cleaned = normalizeSpacing(
    input
      .replace(/[()|,;]+/g, " ")
      .replace(/\b(?:bought|buy|paid|for|each|per|copy|copies|card|pokemon|pokémon)\b/gi, " ")
      .replace(/\b1st\s+ed(?:ition)?\b/gi, "1st Edition"),
  );
  return cleaned.replace(/^1st Edition\s+(.+)$/i, "$1 1st Edition");
}

function normalizeSpacing(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
