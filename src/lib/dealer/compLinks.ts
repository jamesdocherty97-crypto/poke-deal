import type { CardRef, Grade } from "../domain/types.js";

export type ManualCompLinkKind = "EBAY_SOLD" | "CARDMARKET" | "TCGPLAYER";

export interface ManualCompLink {
  kind: ManualCompLinkKind;
  label: string;
  url: string;
}

export function buildManualCompLinks(card: CardRef, grade: Grade): ManualCompLink[] {
  const rawQuery = cardSearchQuery(card);
  const gradedQuery = grade === "RAW" ? rawQuery : `${rawQuery} ${gradeLabel(grade)}`;

  return [
    {
      kind: "EBAY_SOLD",
      label: "eBay sold",
      url: ebaySoldUrl(gradedQuery),
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

export function cardSearchQuery(card: CardRef): string {
  return [card.name, card.number, card.setName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function ebaySoldUrl(query: string): string {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Complete: "1",
    LH_Sold: "1",
    _sop: "13",
  });
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
