import type { CardRef, Grade } from "../domain/types.js";

export type ManualCompLinkKind = "EBAY_UK_SOLD" | "EBAY_ALL_SOLD" | "CARDMARKET" | "TCGPLAYER";

export interface ManualCompLink {
  kind: ManualCompLinkKind;
  label: string;
  url: string;
}

export interface ManualCompLinkOptions {
  searchText?: string;
  condition?: string;
}

export function buildManualCompLinks(card: CardRef, grade: Grade, options: ManualCompLinkOptions = {}): ManualCompLink[] {
  const rawQuery = normalizeManualCompSearchText(options.searchText) || cardSearchQuery(card, { condition: options.condition });
  const gradedQuery = grade === "RAW" ? rawQuery : `${rawQuery} ${gradeLabel(grade)}`;

  return [
    {
      kind: "EBAY_UK_SOLD",
      label: "eBay UK sold",
      url: ebaySoldUrl(gradedQuery, { ukOnly: true }),
    },
    {
      kind: "EBAY_ALL_SOLD",
      label: "eBay all sold",
      url: ebaySoldUrl(gradedQuery, { ukOnly: false }),
    },
    {
      kind: "CARDMARKET",
      label: "Cardmarket",
      url: cardmarketUrl(rawQuery),
    },
    {
      kind: "TCGPLAYER",
      label: "TCGPlayer",
      url: tcgPlayerUrl(rawQuery),
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

function normalizeConditionForSearch(condition: string | undefined): string | undefined {
  const normalized = condition?.trim().toUpperCase();
  if (!normalized || normalized === "NM") return undefined;
  return normalized;
}
