// eBay-ready listing pack generator.
//
// Pure & dependency-free (like the comp engine). Turns a card + grade + comp +
// cost into a copy-ready eBay listing: keyword-rich title (<=80 chars), item
// specifics, condition, UK postage suggestion, suggested price, a copy-ready
// text block, and CSV rows. The eBay Sell API draft-push (Priority 4) layers on
// top of this later — these helpers are what it will submit.
//
// Money is GBP integer pence throughout, matching the rest of the app.

export interface ListingPackCard {
  name: string;
  setName?: string | null;
  number?: string | null;
  rarity?: string | null;
  language?: string | null;
}

export interface ListingPackInput {
  card: ListingPackCard;
  /** Canonical grade, e.g. "RAW", "PSA_10". */
  grade: string;
  /** Cleaned comp median in pence (the value anchor). 0/undefined = unknown. */
  compMedianPence?: number;
  /** What you paid, in pence. Used as a price floor with a minimum margin. */
  costBasisPence?: number;
  /** Minimum margin over cost when comp is missing/low. Default 0.35 (35%). */
  minMargin?: number;
  /** Free-text condition for raw cards, e.g. "Near Mint", "LP". */
  condition?: string | null;
  /** PSA/BGS/CGC cert number, shown in title/specifics for graded slabs. */
  certNumber?: string | null;
}

export interface ListingPack {
  title: string;
  subtitle: string;
  condition: string;
  conditionNote: string;
  itemSpecifics: Record<string, string>;
  suggestedPricePence: number;
  postage: { service: string; pricePence: number };
  description: string;
  /** A single copy-paste block for marketplaces without an API. */
  copyReady: string;
}

const EBAY_TITLE_MAX = 80;

export function gradeDisplay(grade: string): string {
  return grade === "RAW" ? "" : grade.replace(/_/g, " ");
}

export function isGradedGrade(grade: string): boolean {
  return grade !== "RAW" && grade.trim().length > 0;
}

/** Keyword-rich eBay title, trimmed to eBay's 80-char limit without cutting mid-word. */
export function buildEbayTitle(input: ListingPackInput): string {
  const { card, grade } = input;
  const graded = isGradedGrade(grade);
  const parts = [
    card.name,
    card.number ? `${card.number}` : "",
    card.setName ?? "",
    "Pokemon",
    graded ? gradeDisplay(grade) : (input.condition || "Near Mint"),
    graded ? "" : "Raw",
    card.language && card.language !== "EN" ? card.language : "English",
  ].filter((p) => p && p.trim().length > 0);

  let title = parts.join(" ").replace(/\s+/g, " ").trim();
  if (title.length <= EBAY_TITLE_MAX) return title;

  // Trim to the last whole word that fits.
  title = title.slice(0, EBAY_TITLE_MAX);
  const lastSpace = title.lastIndexOf(" ");
  return (lastSpace > 0 ? title.slice(0, lastSpace) : title).trim();
}

export function buildEbaySubtitle(input: ListingPackInput): string {
  const graded = isGradedGrade(input.grade);
  if (graded) {
    return `${gradeDisplay(input.grade)}${input.certNumber ? ` · Cert ${input.certNumber}` : ""} · Fast tracked UK postage`;
  }
  return `${input.condition || "Near Mint"} · Carded & sleeved · Fast UK postage`;
}

export function ebayCondition(input: ListingPackInput): { condition: string; conditionNote: string } {
  if (isGradedGrade(input.grade)) {
    return {
      condition: "Graded",
      conditionNote: `Professionally graded ${gradeDisplay(input.grade)}${
        input.certNumber ? `, cert ${input.certNumber}` : ""
      }. Slab not reholdered; sold as graded.`,
    };
  }
  return {
    condition: "Ungraded",
    conditionNote: `${input.condition || "Near Mint"} condition. Sleeved and top-loadered, posted with care.`,
  };
}

export function buildItemSpecifics(input: ListingPackInput): Record<string, string> {
  const { card, grade } = input;
  const graded = isGradedGrade(grade);
  const specifics: Record<string, string> = {
    Game: "Pokémon TCG",
    "Card Name": card.name,
    Language: card.language && card.language !== "EN" ? card.language : "English",
  };
  if (card.setName) specifics.Set = card.setName;
  if (card.number) specifics["Card Number"] = card.number;
  if (card.rarity) specifics.Rarity = card.rarity;
  if (graded) {
    const grader = grade.split("_")[0] ?? "PSA";
    specifics["Professional Grader"] = grader;
    specifics.Grade = gradeDisplay(grade).replace(`${grader} `, "");
    specifics["Card Condition"] = "Graded";
    if (input.certNumber) specifics.Certification = input.certNumber;
  } else {
    specifics["Card Condition"] = input.condition || "Near Mint";
    specifics.Features = "Holo / Foil";
  }
  return specifics;
}

/** UK-relevant Royal Mail postage suggestion: tracked/signed for graded slabs. */
export function suggestPostage(input: ListingPackInput): { service: string; pricePence: number } {
  if (isGradedGrade(input.grade)) {
    return { service: "Royal Mail Special Delivery / Tracked 48 (signed)", pricePence: 499 };
  }
  return { service: "Royal Mail 1st Class Large Letter", pricePence: 175 };
}

/**
 * Suggested list price: anchor on the comp median; never list below
 * cost * (1 + minMargin). Rounds to a tidy .99/.00 ish boundary (whole pounds).
 */
export function suggestListPricePence(input: ListingPackInput): number {
  const minMargin = Number.isFinite(input.minMargin) && (input.minMargin ?? -1) >= 0 ? input.minMargin! : 0.35;
  const comp = Number.isFinite(input.compMedianPence) && (input.compMedianPence ?? 0) > 0 ? input.compMedianPence! : 0;
  const cost = Number.isFinite(input.costBasisPence) && (input.costBasisPence ?? 0) > 0 ? input.costBasisPence! : 0;
  const floor = cost > 0 ? Math.round(cost * (1 + minMargin)) : 0;
  const anchor = Math.max(comp, floor);
  if (anchor <= 0) return 0;
  return roundToTidyPence(anchor);
}

/** Round up to the nearest whole pound for prices >= £10, else nearest 50p. */
function roundToTidyPence(pence: number): number {
  if (pence >= 1000) return Math.ceil(pence / 100) * 100;
  return Math.ceil(pence / 50) * 50;
}

export function buildDescription(input: ListingPackInput): string {
  const { card, grade } = input;
  const { conditionNote } = ebayCondition(input);
  const idLine = [card.setName, card.number ? `#${card.number}` : null].filter(Boolean).join(" ");
  const gradeLine = isGradedGrade(grade)
    ? `Graded ${gradeDisplay(grade)}${input.certNumber ? ` (cert ${input.certNumber})` : ""}.`
    : `Ungraded single, ${input.condition || "Near Mint"}.`;
  return [
    `${card.name}${idLine ? ` — ${idLine}` : ""}.`,
    gradeLine,
    conditionNote,
    "Genuine Pokémon TCG single from a UK seller. Posted within 1 working day, fully tracked options available.",
    "Smoke-free home. Combined postage on multiple wins — please wait for an invoice.",
  ].join("\n\n");
}

export function buildListingPack(input: ListingPackInput): ListingPack {
  const title = buildEbayTitle(input);
  const subtitle = buildEbaySubtitle(input);
  const { condition, conditionNote } = ebayCondition(input);
  const itemSpecifics = buildItemSpecifics(input);
  const suggestedPricePence = suggestListPricePence(input);
  const postage = suggestPostage(input);
  const description = buildDescription(input);

  const copyReady = [
    `TITLE: ${title}`,
    `PRICE: ${formatGbp(suggestedPricePence)}`,
    `POSTAGE: ${postage.service} (${formatGbp(postage.pricePence)})`,
    `CONDITION: ${condition} — ${conditionNote}`,
    "",
    "ITEM SPECIFICS:",
    ...Object.entries(itemSpecifics).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "DESCRIPTION:",
    description,
  ].join("\n");

  return { title, subtitle, condition, conditionNote, itemSpecifics, suggestedPricePence, postage, description, copyReady };
}

// ── CSV export (eBay-style flat columns) ─────────────────────────────────────

const CSV_COLUMNS = [
  "Title",
  "Card Name",
  "Set",
  "Card Number",
  "Grade",
  "Condition",
  "Suggested Price (GBP)",
  "Postage",
  "Postage (GBP)",
] as const;

export function listingPackCsvHeader(): string {
  return CSV_COLUMNS.map(csvCell).join(",");
}

export function listingPackToCsvRow(input: ListingPackInput): string {
  const pack = buildListingPack(input);
  const row = [
    pack.title,
    input.card.name,
    input.card.setName ?? "",
    input.card.number ?? "",
    input.grade === "RAW" ? "Raw" : gradeDisplay(input.grade),
    pack.condition,
    (pack.suggestedPricePence / 100).toFixed(2),
    pack.postage.service,
    (pack.postage.pricePence / 100).toFixed(2),
  ];
  return row.map(csvCell).join(",");
}

export function buildListingPackCsv(inputs: ListingPackInput[]): string {
  return [listingPackCsvHeader(), ...inputs.map(listingPackToCsvRow)].join("\n");
}

function csvCell(value: string): string {
  const v = String(value ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function formatGbp(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
