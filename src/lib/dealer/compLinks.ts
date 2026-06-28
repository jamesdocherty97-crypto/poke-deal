import type { CardRef, Grade } from "../domain/types.js";
import { textMentionsFirstEdition } from "../comps/variants.js";

export type ManualCompLinkKind = "EBAY_UK_SOLD" | "EBAY_ALL_SOLD" | "CARDMARKET" | "TCGPLAYER";

export interface ManualCompLink {
  kind: ManualCompLinkKind;
  label: string;
  url: string;
  query: string;
  primary?: boolean;
}

export interface ManualCompLinkOptions {
  searchText?: string;
  condition?: string;
  typedText?: string;
}

const RAW_EBAY_EXCLUSIONS = ["-PSA", "-BGS", "-CGC", "-ACE", "-SGC", "-graded"];

export function buildManualCompLinks(card: CardRef, grade: Grade, options: ManualCompLinkOptions = {}): ManualCompLink[] {
  const rawQuery =
    normalizeManualCompSearchText(options.searchText) ||
    buildManualCompFallbackQuery(card, { condition: options.condition, typedText: options.typedText });
  const ebayQuery = ebaySoldSearchQuery(rawQuery, grade);

  return [
    {
      kind: "EBAY_UK_SOLD",
      label: "eBay UK",
      url: ebaySoldUrl(ebayQuery, { ukOnly: true }),
      query: ebayQuery,
      primary: true,
    },
    {
      kind: "EBAY_ALL_SOLD",
      label: "Widen",
      url: ebaySoldUrl(ebayQuery, { ukOnly: false }),
      query: ebayQuery,
    },
    {
      kind: "CARDMARKET",
      label: "Cardmarket",
      url: cardmarketUrl(rawQuery),
      query: rawQuery,
    },
    {
      kind: "TCGPLAYER",
      label: "TCGPlayer",
      url: tcgPlayerUrl(rawQuery),
      query: rawQuery,
    },
  ];
}

export function cardSearchQuery(card: CardRef, options: { condition?: string } = {}): string {
  const condition = normalizeConditionForSearch(options.condition);
  const coreParts = [card.name, humanizeCollectorNumber(card.number), card.setName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return [...coreParts, ...(coreParts.length > 0 && condition ? [condition] : [])]
    .join(" ");
}

/**
 * Modern promo collector numbers (SVP208, MEP0079, XY01, ...) are stored joined
 * in the catalog, but human dealer search wording — and eBay sold results —
 * prefer "SVP 208" / "MEP 079". Galarian/Trainer Gallery numbers (GG30, TG06)
 * are left untouched: that joined form is the standard collector convention.
 */
function humanizeCollectorNumber(number: string | undefined): string | undefined {
  if (!number) return number;
  return number.replace(
    /^(SVP|MEP|SWSH|SM|XY|BW|DP|HGSS)\s*0*(\d{1,4})$/i,
    (_, prefix: string, digits: string) => formatPromoCollectorNumber(prefix, digits),
  );
}

function formatPromoCollectorNumber(prefix: string, digits: string): string {
  return `${prefix.toUpperCase()} ${digits.padStart(3, "0")}`;
}

export function buildManualCompFallbackQuery(
  card: CardRef,
  options: { condition?: string; typedText?: string } = {},
): string {
  const base = cardSearchQuery(card, { condition: options.condition });
  const typed = normalizeManualCompSearchText(options.typedText);
  const additions: string[] = [];

  if (textMentionsFirstEdition(typed) && !textMentionsFirstEdition(base)) {
    additions.push("1st Edition");
  }

  const typedCondition = rawConditionFromSearchText(typed);
  if (typedCondition && !queryMentionsCondition(base, typedCondition)) {
    additions.push(typedCondition);
  }

  return normalizeManualCompSearchText([base, ...additions].filter(Boolean).join(" "));
}

export function normalizeManualCompSearchText(input: string | undefined): string {
  if (!input?.trim()) return "";
  return input
      // "208 IR Promo (SVP)" -> "SVP 208" — human wording, not joined.
      .replace(
        /\b0?(\d{1,4})\s+(?:(?:IR|SIR|SAR|AR|illustration\s+rare|special\s+illustration\s+rare)\s+)?(?:promo\s*)?\(\s*(SVP|MEP|SWSH|SM|XY|BW|DP|HGSS)\s*\)(?=\s|$)/gi,
        (_, digits: string, prefix: string) => formatPromoCollectorNumber(prefix, digits),
      )
      // "079 promo" with no explicit prefix defaults to SVP (modern S&V promos).
      .replace(
        /\b0?(\d{1,4})\s+(?:(?:IR|SIR|SAR|AR|illustration\s+rare|special\s+illustration\s+rare)\s+)?promo\b(?=\s|$)/gi,
        (_, digits: string) => formatPromoCollectorNumber("SVP", digits),
      )
      .replace(/[–—-]+/g, " ")
    // Canonicalize promo prefix + number spacing/padding either way it was typed
    // ("MEP0079", "mep 79", "SVP208") into standard human wording "MEP 079" / "SVP 208".
    .replace(/\b(SVP|MEP|SWSH|SM|XY|BW|DP|HGSS)\s*0*(\d{1,4})\b/gi, (_, prefix: string, digits: string) =>
      formatPromoCollectorNumber(prefix, digits),
    )
    // Galarian/Trainer Gallery numbers are the standard-convention exception: keep these joined.
    .replace(/\b(GG|TG)\s+0*(\d{1,2})\b/gi, (_, prefix: string, digits: string) =>
      `${prefix.toUpperCase()}${digits.padStart(2, "0")}`,
    )
    .replace(/(?:£\s*)\d+(?:[.,]\d{1,2})?/gi, " ")
    .replace(/\b(?:paid|cost|buy|bought)\s*(?:£\s*)?\d+(?:[.,]\d{1,2})?\b/gi, " ")
    .replace(/\b(?:paid|cost|buy|bought)\b/gi, " ")
    .replace(/\b(?:list|listing|sell|selling|post|post\s+on|channel)\s+(?:on\s+|to\s+|via\s+)?(?:ebay|cardmarket|vinted)\b/gi, " ")
    .replace(/\b(?:sell|selling|channel)\s+(?:in\s+person|cash|at\s+show|at\s+fair)\b/gi, " ")
    .replace(/\b(?:active|listed|live|draft|drafted)\s*(?:listing)?\b/gi, " ")
    .replace(/\b(?:qty|quantity)\s*\d{1,3}\b/gi, " ")
    .replace(/(?:^|\s)(?:x\s*\d{1,3}|\d{1,3}\s*x)(?=\s|$)/gi, " ")
    .replace(/\b(?:from|via|at)\s+(?:card\s+fair|facebook|fb|ebay|cardmarket|vinted|whatnot|collection)\b/gi, " ")
    .replace(/\b(?:card\s+fair|facebook|fb|vinted|whatnot|trade[\s-]?in)\b/gi, " ")
    .replace(/\b(?:box\s*[ab]|binder|to\s+list|slabs?|singles?)\b/gi, " ")
    .replace(/\b(?:raw|ungraded)\b/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function ebaySoldSearchQuery(rawQuery: string, grade: Grade): string {
  const normalized = normalizeManualCompSearchText(rawQuery);
  if (!normalized) return "";

  if (grade !== "RAW") {
    return queryMentionsGrade(normalized, grade)
      ? normalized
      : `${normalized} ${gradeSearchTerm(grade)}`;
  }

  if (queryMentionsGrade(normalized, "")) return normalized;
  return appendMissingTerms(normalized, RAW_EBAY_EXCLUSIONS);
}

function ebaySoldUrl(query: string, options: { ukOnly: boolean }): string {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Complete: "1",
    LH_Sold: "1",
    _sop: "13",
  });
  if (options.ukOnly) params.set("LH_PrefLoc", "1");
  return `https://www.ebay.co.uk/sch/i.html?${params.toString()}`;
}

function cardmarketUrl(query: string): string {
  const params = new URLSearchParams({ searchString: query });
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?${params.toString()}`;
}

function tcgPlayerUrl(query: string): string {
  const params = new URLSearchParams({
    productLineName: "pokemon",
    q: query,
    view: "grid",
  });
  return `https://www.tcgplayer.com/search/pokemon/product?${params.toString()}`;
}

function gradeLabel(grade: Grade): string {
  return grade.replace(/_(\d)_5$/g, " $1.5").replace(/_(\d+)$/g, " $1").replace(/_/g, " ");
}

function compactGradeLabel(label: string): string {
  return label.replace(/\s+/g, "");
}

// eBay sold search results respond better to plain human grade wording
// ("BGS 9.5", "ACE 10") than to boolean/bracketed OR syntax — the latter
// measurably hurts match rates, so graded eBay searches use this directly.
function gradeSearchTerm(grade: Grade): string {
  return gradeLabel(grade);
}

function queryMentionsGrade(query: string, grade: Grade | ""): boolean {
  const normalized = query.toUpperCase().replace(/\s+/g, " ");
  if (grade) {
    const label = gradeLabel(grade);
    const compact = compactGradeLabel(label);
    if (normalized.includes(label.toUpperCase()) || normalized.replace(/\s+/g, "").includes(compact.toUpperCase())) {
      return true;
    }
  }
  return /\b(?:PSA|BGS|CGC|ACE|SGC)\s*(?:10|9(?:\.5)?|[1-8](?:\.5)?)\b/.test(normalized) || /\bGRADED\b/.test(normalized);
}

function appendMissingTerms(query: string, terms: string[]): string {
  const upper = query.toUpperCase();
  const missing = terms.filter((term) => !upper.includes(term.toUpperCase()));
  return [query, ...missing].join(" ").trim();
}

function rawConditionFromSearchText(text: string): string | null {
  const normalized = text.toUpperCase().replace(/\s+/g, " ");
  if (/\b(?:LIGHTLY\s+PLAYED|LIGHT\s+PLAY|LP)\b/.test(normalized)) return "LP";
  if (/\b(?:MODERATELY\s+PLAYED|MP)\b/.test(normalized)) return "MP";
  if (/\b(?:HEAVILY\s+PLAYED|HP)\b/.test(normalized)) return "HP";
  if (/\b(?:DAMAGED|DMG)\b/.test(normalized)) return "DMG";
  if (/\b(?:NEAR\s+MINT|NM)\b/.test(normalized)) return "NM";
  return null;
}

function queryMentionsCondition(query: string, condition: string): boolean {
  const normalized = query.toUpperCase().replace(/\s+/g, " ");
  if (condition === "LP") return /\b(?:LIGHTLY\s+PLAYED|LIGHT\s+PLAY|LP)\b/.test(normalized);
  if (condition === "MP") return /\b(?:MODERATELY\s+PLAYED|MP)\b/.test(normalized);
  if (condition === "HP") return /\b(?:HEAVILY\s+PLAYED|HP)\b/.test(normalized);
  if (condition === "DMG") return /\b(?:DAMAGED|DMG)\b/.test(normalized);
  if (condition === "NM") return /\b(?:NEAR\s+MINT|NM)\b/.test(normalized);
  return false;
}

function normalizeConditionForSearch(condition: string | undefined): string | undefined {
  const normalized = condition?.trim().toUpperCase();
  if (!normalized || normalized === "NM") return undefined;
  return normalized;
}
