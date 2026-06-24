import type { CardRef, Grade } from "../domain/types.js";

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
}

const RAW_EBAY_EXCLUSIONS = ["-PSA", "-BGS", "-CGC", "-ACE", "-SGC", "-graded"];

export function buildManualCompLinks(card: CardRef, grade: Grade, options: ManualCompLinkOptions = {}): ManualCompLink[] {
  const rawQuery = normalizeManualCompSearchText(options.searchText) || cardSearchQuery(card, { condition: options.condition });
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
  return [card.name, card.number, card.setName, condition]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

export function normalizeManualCompSearchText(input: string | undefined): string {
  if (!input?.trim()) return "";
  return input
    .replace(/[–—-]+/g, " ")
    .replace(/\b(SVP|MEP|SWSH|SM|XY|BW|DP|HGSS)\s+0?(\d{1,4})\b/gi, (_, prefix: string, digits: string) =>
      `${prefix.toUpperCase()}${digits.padStart(3, "0")}`,
    )
    .replace(/\b(?!(?:SET|PSA|BGS|CGC|ACE|SGC)\b)([A-Z]{2,5})\s+(\d{1,4})\b/gi, (_, prefix: string, digits: string) =>
      `${prefix.toUpperCase()}${digits}`,
    )
    .replace(/(?:£\s*)\d+(?:[.,]\d{1,2})?/gi, " ")
    .replace(/\b(?:paid|cost|buy|bought)\s*(?:£\s*)?\d+(?:[.,]\d{1,2})?\b/gi, " ")
    .replace(/\b(?:paid|cost|buy|bought)\b/gi, " ")
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
    const label = gradeLabel(grade);
    return queryMentionsGrade(normalized, label) ? normalized : `${normalized} ${label}`;
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
  return grade.replace(/_(\d)$/g, " $1").replace(/_/g, " ").replace("9 5", "9.5");
}

function queryMentionsGrade(query: string, gradeLabelValue: string): boolean {
  const normalized = query.toUpperCase().replace(/\s+/g, " ");
  if (gradeLabelValue && normalized.includes(gradeLabelValue.toUpperCase())) return true;
  return /\b(?:PSA|BGS|CGC|ACE|SGC)\s*(?:10|9(?:\.5)?|[1-8])\b/.test(normalized) || /\bGRADED\b/.test(normalized);
}

function appendMissingTerms(query: string, terms: string[]): string {
  const upper = query.toUpperCase();
  const missing = terms.filter((term) => !upper.includes(term.toUpperCase()));
  return [query, ...missing].join(" ").trim();
}

function normalizeConditionForSearch(condition: string | undefined): string | undefined {
  const normalized = condition?.trim().toUpperCase();
  if (!normalized || normalized === "NM") return undefined;
  return normalized;
}
