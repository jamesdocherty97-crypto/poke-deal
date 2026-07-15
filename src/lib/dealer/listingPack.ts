// Marketplace-ready listing pack generator.
//
// Pure & dependency-free (like the comp engine). Turns a card + grade + comp +
// cost into a copy-ready eBay listing: keyword-rich title (<=80 chars), item
// specifics, condition, UK postage suggestion, suggested price, a copy-ready
// text block, and CSV rows. The eBay Sell API draft-push (Priority 4) layers on
// top of this later — these helpers are what it will submit.
//
// Money is GBP integer pence throughout, matching the rest of the app.

import { STOCK_IMAGE_DISCLOSURE } from "../photos/listingPhotoPolicy.js";
import { formatGbp } from "../format/money.js";

export interface ListingPackCard {
  name: string;
  setName?: string | null;
  number?: string | null;
  rarity?: string | null;
  language?: string | null;
}

/**
 * Context proving that `compMedianPence` came from a recent sold sample.
 *
 * Every core field is optional so callers can pass through partially available
 * evidence, but listing copy only mentions pricing when sample size, window and
 * as-of date are all valid. `sourceRegion` is useful context, not a prerequisite.
 */
export interface ListingSoldEvidenceContext {
  sampleSize?: number;
  windowDays?: number;
  compAsOf?: string | Date;
  sourceRegion?: string | null;
}

export interface ListingPackInput {
  card: ListingPackCard;
  /** Marketplace/channel the copy is being prepared for. Defaults to eBay. */
  channel?: ListingPackChannel;
  /** Canonical grade, e.g. "RAW", "PSA_10". */
  grade: string;
  /** Saved listing price in pence. Used exactly when present. */
  listPricePence?: number;
  /** Cleaned comp median in pence (the value anchor). 0/undefined = unknown. */
  compMedianPence?: number;
  /** Optional audit context for a genuine sold comp sample. Never inferred. */
  soldEvidence?: ListingSoldEvidenceContext;
  /** What you paid, in pence. Used as a price floor with a minimum margin. */
  costBasisPence?: number;
  /** Minimum margin over cost when comp is missing/low. Default 0.35 (35%). */
  minMargin?: number;
  /** Free-text condition for raw cards, e.g. "Near Mint", "LP". */
  condition?: string | null;
  /** PSA/BGS/CGC cert number, shown in title/specifics for graded slabs. */
  certNumber?: string | null;
  /** Editable listing boilerplate from Settings. Defaults keep the app usable. */
  copySettings?: Partial<ListingCopySettings>;
  /** True when an eBay listing will use catalog art only, not real item photos. */
  usesCatalogOnlyImages?: boolean;
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
  photoDisclosure?: string | null;
  /** A single copy-paste block for marketplaces without an API. */
  copyReady: string;
}

export interface ListingPackCopyField {
  key: string;
  label: string;
  value: string;
}

export type ListingPackChannel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";

export interface ListingCopySettings {
  postageTerms: string;
  returnsLine: string;
}

export const DEFAULT_LISTING_COPY_SETTINGS: ListingCopySettings = {
  postageTerms: "Posted within 1 working day from the UK. Singles are sleeved/top-loaded and slabs are boxed securely. Buyer pays postage unless stated otherwise.",
  returnsLine: "Returns accepted in line with marketplace policy; please contact me first if anything looks wrong.",
};

const EBAY_TITLE_MAX = 80;

export function gradeDisplay(grade: string): string {
  return grade === "RAW" ? "" : grade.replace(/_/g, " ");
}

export function gradeListingPhrase(grade: string): string {
  if (!isGradedGrade(grade)) return "";
  const display = gradeDisplay(grade).trim();
  const match = display.match(/^([A-Z]+)\s+([0-9]+(?:\.[0-9])?)$/i);
  if (!match) return display;

  const grader = match[1]!.toUpperCase();
  const score = match[2]!;
  const suffix = gradeSuffix(score);
  return [grader, score, suffix].filter(Boolean).join(" ");
}

export function isGradedGrade(grade: string): boolean {
  return grade !== "RAW" && grade.trim().length > 0;
}

/** Keyword-rich eBay title, trimmed to eBay's 80-char limit without cutting mid-word. */
export function buildEbayTitle(input: ListingPackInput): string {
  const { card, grade } = input;
  const graded = isGradedGrade(grade);
  const identity = ["Pokemon TCG", card.name];
  const setName = card.setName?.trim() ?? "";
  const number = card.number?.trim() ?? "";
  const gradeOrCondition = graded
    ? gradeListingPhrase(grade)
    : `${input.condition || "Near Mint"} Raw`;
  const language = card.language && card.language !== "EN" ? card.language : "English";

  const candidates = [
    [...identity, setName, number, gradeOrCondition, language],
    [...identity, setName, number, gradeOrCondition],
    [...identity, number, gradeOrCondition, language],
    [...identity, number, gradeOrCondition],
  ].map(joinTitleParts);
  const fitting = candidates.find((candidate) => candidate.length <= EBAY_TITLE_MAX);
  if (fitting) return fitting;

  // Keep identity, collector number and grade/condition intact. A long set is
  // shortened before the search-critical tail is touched.
  const withoutSet = joinTitleParts([...identity, number, gradeOrCondition]);
  const setBudget = EBAY_TITLE_MAX - withoutSet.length - 1;
  if (setName && setBudget >= 4) {
    const shortenedSet = trimTitlePart(setName, setBudget);
    const withShortSet = joinTitleParts([...identity, shortenedSet, number, gradeOrCondition]);
    if (withShortSet.length <= EBAY_TITLE_MAX) return withShortSet;
  }

  const fixedPrefix = "Pokemon TCG";
  const fixedTail = joinTitleParts([number, gradeOrCondition]);
  const nameBudget = EBAY_TITLE_MAX - fixedPrefix.length - fixedTail.length - 2;
  return joinTitleParts([
    fixedPrefix,
    trimTitlePart(card.name, Math.max(1, nameBudget)),
    fixedTail,
  ]).slice(0, EBAY_TITLE_MAX).trim();
}

export function buildEbaySubtitle(input: ListingPackInput): string {
  const graded = isGradedGrade(input.grade);
  if (graded) {
    return `${gradeListingPhrase(input.grade)}${input.certNumber ? ` · Cert ${input.certNumber}` : ""} · Fast tracked UK postage`;
  }
  return `${input.condition || "Near Mint"} · Carded & sleeved · Fast UK postage`;
}

export function listingPackChannelLabel(channel: ListingPackChannel | undefined): string {
  if (channel === "CARDMARKET") return "Cardmarket";
  if (channel === "VINTED") return "Vinted";
  if (channel === "IN_PERSON") return "In-person";
  return "eBay";
}

export function ebayCondition(input: ListingPackInput): { condition: string; conditionNote: string } {
  if (isGradedGrade(input.grade)) {
    return {
      condition: "Graded",
      conditionNote: `Professionally graded ${gradeListingPhrase(input.grade)}${
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
  if (input.channel === "VINTED") {
    return { service: "Buyer pays Vinted postage", pricePence: 0 };
  }
  if (input.channel === "CARDMARKET") {
    return { service: "Buyer pays Cardmarket postage", pricePence: 0 };
  }
  if (input.channel === "IN_PERSON") {
    return { service: "Collection / handover", pricePence: 0 };
  }
  if (isGradedGrade(input.grade)) {
    return { service: "Royal Mail Special Delivery / Tracked 48 (signed)", pricePence: 499 };
  }
  return { service: "Royal Mail 1st Class Large Letter", pricePence: 175 };
}

/**
 * Suggested list price: respect an explicit saved listing price first; otherwise
 * anchor on the comp median and never list below cost * (1 + minMargin).
 * Derived prices round to a tidy boundary, but saved prices stay exact.
 */
export function suggestListPricePence(input: ListingPackInput): number {
  const explicit = positivePence(input.listPricePence);
  if (explicit > 0) return explicit;

  const minMargin = Number.isFinite(input.minMargin) && (input.minMargin ?? -1) >= 0 ? input.minMargin! : 0.35;
  const comp = positivePence(input.compMedianPence);
  const cost = positivePence(input.costBasisPence);
  const floor = cost > 0 ? Math.round(cost * (1 + minMargin)) : 0;
  const anchor = Math.max(comp, floor);
  if (anchor <= 0) return 0;
  return roundToTidyPence(anchor);
}

function positivePence(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return 0;
  return Math.round(value!);
}

/** Round up to the nearest whole pound for prices >= £10, else nearest 50p. */
function roundToTidyPence(pence: number): number {
  if (pence >= 1000) return Math.ceil(pence / 100) * 100;
  return Math.ceil(pence / 50) * 50;
}

export function buildDescription(input: ListingPackInput): string {
  if (input.channel === "VINTED") return buildVintedDescription(input);
  if (input.channel === "CARDMARKET") return buildCardmarketDescription(input);
  if (input.channel === "IN_PERSON") return buildInPersonDescription(input);

  const settings = resolveListingCopySettings(input.copySettings);
  const { card, grade } = input;
  const { conditionNote } = ebayCondition(input);
  const idLine = [card.setName, card.number ? `#${card.number}` : null].filter(Boolean).join(" ");
  const gradeLine = isGradedGrade(grade)
    ? `Graded ${gradeListingPhrase(grade)}${input.certNumber ? ` (cert ${input.certNumber})` : ""}.`
    : `Ungraded single, ${input.condition || "Near Mint"}.`;
  const pricingEvidence = buildSoldEvidenceSentence(input);
  return [
    `${card.name}${idLine ? ` — ${idLine}` : ""}.`,
    gradeLine,
    conditionNote,
    input.usesCatalogOnlyImages ? STOCK_IMAGE_DISCLOSURE : null,
    "Genuine Pokémon TCG single from a UK seller.",
    pricingEvidence,
    settings.postageTerms,
    settings.returnsLine,
  ].filter(Boolean).join("\n\n");
}

function buildVintedDescription(input: ListingPackInput): string {
  const settings = resolveListingCopySettings(input.copySettings);
  const { card, grade } = input;
  const idLine = [card.setName, card.number ? `#${card.number}` : null].filter(Boolean).join(" ");
  const condition = isGradedGrade(grade)
    ? `${gradeListingPhrase(grade)}${input.certNumber ? `, cert ${input.certNumber}` : ""}`
    : input.condition || "Near Mint";

  return [
    `${card.name}${idLine ? ` - ${idLine}` : ""}`,
    `Condition: ${condition}`,
    "Genuine Pokemon TCG single from a UK seller.",
    "Happy to bundle with other cards.",
    buildSoldEvidenceSentence(input),
    settings.postageTerms,
  ].filter(Boolean).join("\n\n");
}

function buildCardmarketDescription(input: ListingPackInput): string {
  const settings = resolveListingCopySettings(input.copySettings);
  const { card, grade } = input;
  const condition = isGradedGrade(grade)
    ? `${gradeListingPhrase(grade)}${input.certNumber ? `, cert ${input.certNumber}` : ""}`
    : input.condition || "Near Mint";
  const cmCondition = cardmarketConditionCode(input.condition);

  return [
    `${card.name}${card.number ? ` ${card.number}` : ""}${card.setName ? ` - ${card.setName}` : ""}`,
    `Condition/grade: ${condition}`,
    `Cardmarket condition: ${cmCondition}.`,
    `${listingLanguage(card.language)} Pokemon TCG single.`,
    buildSoldEvidenceSentence(input),
    settings.postageTerms,
  ].filter(Boolean).join("\n\n");
}

function buildInPersonDescription(input: ListingPackInput): string {
  const { card, grade } = input;
  const condition = isGradedGrade(grade)
    ? `${gradeListingPhrase(grade)}${input.certNumber ? `, cert ${input.certNumber}` : ""}`
    : input.condition || "Near Mint";

  return [
    `${card.name}${card.number ? ` ${card.number}` : ""}${card.setName ? ` - ${card.setName}` : ""}`,
    condition,
    "In-person sale note. Buyer can inspect before payment.",
    buildSoldEvidenceSentence(input),
  ].filter(Boolean).join("\n");
}

/**
 * An evidence sentence is deliberately all-or-nothing. A median without its
 * sample, observation window and timestamp is useful for internal pricing, but
 * is not honest buyer-facing evidence.
 */
function buildSoldEvidenceSentence(input: ListingPackInput): string | null {
  const pricePence = positivePence(input.compMedianPence);
  const evidence = input.soldEvidence;
  const sampleSize = evidence?.sampleSize;
  const windowDays = evidence?.windowDays;
  const asOf = evidence ? normaliseEvidenceDate(evidence.compAsOf) : null;

  if (
    pricePence <= 0 ||
    !Number.isInteger(sampleSize) ||
    (sampleSize ?? 0) <= 0 ||
    !Number.isInteger(windowDays) ||
    (windowDays ?? 0) <= 0 ||
    !asOf
  ) {
    return null;
  }

  const region = String(evidence?.sourceRegion ?? "").replace(/\s+/g, " ").trim();
  const regionSuffix = region ? `, ${region}` : "";
  return `Recent sold evidence centres around ${formatGbp(pricePence)} (n=${sampleSize} across a ${windowDays}-day window, as of ${asOf}${regionSuffix}).`;
}

function normaliseEvidenceDate(value: string | Date | undefined): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function buildListingPack(input: ListingPackInput): ListingPack {
  const title = buildListingTitle(input);
  const subtitle = buildEbaySubtitle(input);
  const { condition, conditionNote } = ebayCondition(input);
  const itemSpecifics = buildItemSpecifics(input);
  const suggestedPricePence = suggestListPricePence(input);
  const postage = suggestPostage(input);
  const description = buildDescription(input);
  const photoDisclosure = input.channel === "EBAY" || input.channel == null
    ? input.usesCatalogOnlyImages
      ? STOCK_IMAGE_DISCLOSURE
      : null
    : null;

  const copyReady = [
    `CHANNEL: ${listingPackChannelLabel(input.channel)}`,
    `TITLE: ${title}`,
    `PRICE: ${formatGbp(suggestedPricePence)}`,
    `POSTAGE: ${postage.service}${postage.pricePence > 0 ? ` (${formatGbp(postage.pricePence)})` : ""}`,
    `CONDITION: ${condition} — ${conditionNote}`,
    "",
    "ITEM SPECIFICS:",
    ...Object.entries(itemSpecifics).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "DESCRIPTION:",
    description,
  ].join("\n");

  return { title, subtitle, condition, conditionNote, itemSpecifics, suggestedPricePence, postage, description, photoDisclosure, copyReady };
}

export function listingPackCopyFields(pack: ListingPack): ListingPackCopyField[] {
  return [
    { key: "title", label: "Title", value: pack.title },
    { key: "price", label: "Price", value: (pack.suggestedPricePence / 100).toFixed(2) },
    { key: "description", label: "Description", value: pack.description },
    {
      key: "specifics",
      label: "Specifics",
      value: Object.entries(pack.itemSpecifics)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
    },
  ];
}

// ── CSV export (eBay-style flat columns) ─────────────────────────────────────

const EBAY_CSV_COLUMNS = [
  "Action(SiteID=UK|Country=GB|Currency=GBP|Version=1193)",
  "Category",
  "Title",
  "Description",
  "Condition",
  "Quantity",
  "Format",
  "StartPrice",
  "PostageService-1:Option",
  "PostageService-1:Cost",
  "DispatchTimeMax",
  "ReturnsAcceptedOption",
  "CustomLabel",
  "ItemSpecifics:Game",
  "ItemSpecifics:Card Name",
  "ItemSpecifics:Set",
  "ItemSpecifics:Card Number",
  "ItemSpecifics:Professional Grader",
  "ItemSpecifics:Grade",
  "ItemSpecifics:Certification Number",
] as const;

const CARDMARKET_CSV_COLUMNS = [
  "Card Name",
  "Expansion",
  "Collector Number",
  "Language",
  "Condition",
  "Professional Grader",
  "Grade",
  "Certification Number",
  "Price (GBP)",
  "Quantity",
  "Comments",
] as const;

const VINTED_CSV_COLUMNS = [
  "Title",
  "Description",
  "Category",
  "Brand",
  "Condition",
  "Price (GBP)",
  "Parcel Size",
  "Quantity",
  "Reference",
] as const;

const IN_PERSON_CSV_COLUMNS = [
  "Item",
  "Set",
  "Collector Number",
  "Grade / Condition",
  "Certification Number",
  "Asking Price (GBP)",
  "Quantity",
  "Handover",
  "Notes",
] as const;

export function listingPackCsvHeader(channel: ListingPackChannel = "EBAY"): string {
  return csvColumnsForChannel(channel).map(csvCell).join(",");
}

export function listingPackToCsvRow(input: ListingPackInput): string {
  const channel = input.channel ?? "EBAY";
  if (channel === "CARDMARKET") return cardmarketCsvRow(input);
  if (channel === "VINTED") return vintedCsvRow(input);
  if (channel === "IN_PERSON") return inPersonCsvRow(input);
  return ebayCsvRow(input);
}

function ebayCsvRow(input: ListingPackInput): string {
  const pack = buildListingPack(input);
  const row = [
    "Add",
    "183454",
    pack.title,
    pack.description.replace(/\n+/g, " | "),
    pack.condition,
    "1",
    "FixedPrice",
    (pack.suggestedPricePence / 100).toFixed(2),
    ebayPostageService(input),
    (pack.postage.pricePence / 100).toFixed(2),
    "1",
    "ReturnsAccepted",
    buildCustomLabel(input),
    "Pokemon TCG",
    input.card.name,
    input.card.setName ?? "",
    input.card.number ?? "",
    pack.itemSpecifics["Professional Grader"] ?? "",
    pack.itemSpecifics.Grade ?? "",
    pack.itemSpecifics.Certification ?? "",
  ];
  return row.map(csvCell).join(",");
}

export function buildListingPackCsv(inputs: ListingPackInput[]): string {
  const channel = commonListingPackChannel(inputs);
  return [listingPackCsvHeader(channel), ...inputs.map(listingPackToCsvRow)].join("\n");
}

function cardmarketCsvRow(input: ListingPackInput): string {
  const pack = buildListingPack(input);
  const graded = isGradedGrade(input.grade);
  const row = [
    input.card.name,
    input.card.setName ?? "",
    input.card.number ?? "",
    listingLanguage(input.card.language),
    graded ? "Graded" : cardmarketConditionCode(input.condition),
    graded ? pack.itemSpecifics["Professional Grader"] ?? "" : "",
    graded ? pack.itemSpecifics.Grade ?? "" : "",
    graded ? input.certNumber ?? "" : "",
    (pack.suggestedPricePence / 100).toFixed(2),
    "1",
    flattenCsvText(pack.description),
  ];
  return row.map(csvCell).join(",");
}

function vintedCsvRow(input: ListingPackInput): string {
  const pack = buildListingPack(input);
  const row = [
    pack.title,
    flattenCsvText(pack.description),
    "Hobbies & collectables > Trading cards",
    "Pokémon",
    vintedCondition(input),
    (pack.suggestedPricePence / 100).toFixed(2),
    "Small",
    "1",
    buildCustomLabel(input),
  ];
  return row.map(csvCell).join(",");
}

function inPersonCsvRow(input: ListingPackInput): string {
  const pack = buildListingPack(input);
  const row = [
    input.card.name,
    input.card.setName ?? "",
    input.card.number ?? "",
    isGradedGrade(input.grade) ? gradeListingPhrase(input.grade) : input.condition || "Near Mint",
    input.certNumber ?? "",
    (pack.suggestedPricePence / 100).toFixed(2),
    "1",
    "Collection / handover",
    flattenCsvText(pack.description),
  ];
  return row.map(csvCell).join(",");
}

function commonListingPackChannel(inputs: ListingPackInput[]): ListingPackChannel {
  const channels = new Set<ListingPackChannel>(inputs.map((input) => input.channel ?? "EBAY"));
  if (channels.size <= 1) return channels.values().next().value ?? "EBAY";
  throw new Error("A listing-pack CSV can only contain one channel");
}

function csvColumnsForChannel(channel: ListingPackChannel): readonly string[] {
  if (channel === "CARDMARKET") return CARDMARKET_CSV_COLUMNS;
  if (channel === "VINTED") return VINTED_CSV_COLUMNS;
  if (channel === "IN_PERSON") return IN_PERSON_CSV_COLUMNS;
  return EBAY_CSV_COLUMNS;
}

function flattenCsvText(value: string): string {
  return value.replace(/\s*\n+\s*/g, " | ").trim();
}

function listingLanguage(language: string | null | undefined): string {
  if (!language || language === "EN") return "English";
  return language;
}

function vintedCondition(input: ListingPackInput): "Very good" | "Good" | "Satisfactory" {
  if (isGradedGrade(input.grade)) return "Very good";
  const code = cardmarketConditionCode(input.condition);
  if (code === "NM") return "Very good";
  if (code === "EX") return "Good";
  return "Satisfactory";
}

function csvCell(value: string): string {
  const v = String(value ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function buildListingTitle(input: ListingPackInput): string {
  if (input.channel === "VINTED") return buildVintedTitle(input);
  if (input.channel === "CARDMARKET") return buildCardmarketTitle(input);
  if (input.channel === "IN_PERSON") return buildInPersonTitle(input);
  return buildEbayTitle(input);
}

function buildVintedTitle(input: ListingPackInput): string {
  const { card, grade } = input;
  const parts = [
    card.name,
    card.setName ?? "",
    card.number ?? "",
    isGradedGrade(grade) ? gradeListingPhrase(grade) : input.condition || "Near Mint",
    "Pokemon card",
  ];
  return trimEbayTitle(parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
}

function buildCardmarketTitle(input: ListingPackInput): string {
  const { card, grade } = input;
  const parts = [
    card.name,
    card.number ?? "",
    card.setName ?? "",
    isGradedGrade(grade) ? gradeListingPhrase(grade) : cardmarketConditionCode(input.condition),
  ];
  return trimEbayTitle(parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
}

function buildInPersonTitle(input: ListingPackInput): string {
  const { card, grade } = input;
  const parts = [
    card.name,
    card.setName ?? "",
    card.number ?? "",
    isGradedGrade(grade) ? gradeListingPhrase(grade) : input.condition || "Raw",
  ];
  return trimEbayTitle(parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
}

function trimEbayTitle(title: string): string {
  if (title.length <= EBAY_TITLE_MAX) return title;
  const trimmed = title.slice(0, EBAY_TITLE_MAX);
  const lastSpace = trimmed.lastIndexOf(" ");
  return (lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed).trim();
}

function joinTitleParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part) => Boolean(part?.trim())).join(" ").replace(/\s+/g, " ").trim();
}

function trimTitlePart(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const slice = clean.slice(0, Math.max(1, maxLength));
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace >= 3 ? slice.slice(0, lastSpace) : slice).trim();
}

function gradeSuffix(score: string): string {
  if (score === "10") return "GEM MINT";
  if (score === "9.5") return "GEM MINT";
  if (score === "9") return "MINT";
  if (score === "8.5") return "NM-MT+";
  if (score === "8") return "NM-MT";
  if (score === "7.5") return "NM+";
  if (score === "7") return "NM";
  return "";
}

export function cardmarketConditionCode(condition: string | null | undefined): "NM" | "EX" | "GD" {
  const normalized = (condition ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  if (!normalized || /\b(NM|NEAR MINT|MINT)\b/.test(normalized)) return "NM";
  if (/\b(EX|EXCELLENT|LP|LIGHT PLAYED|LIGHTLY PLAYED)\b/.test(normalized)) return "EX";
  return "GD";
}

export function resolveListingCopySettings(settings: Partial<ListingCopySettings> | undefined): ListingCopySettings {
  return {
    postageTerms: sanitizeBoilerplate(settings?.postageTerms) || DEFAULT_LISTING_COPY_SETTINGS.postageTerms,
    returnsLine: sanitizeBoilerplate(settings?.returnsLine) || DEFAULT_LISTING_COPY_SETTINGS.returnsLine,
  };
}

function sanitizeBoilerplate(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+\n/g, "\n").trim();
}

function ebayPostageService(input: ListingPackInput): string {
  if (input.channel === "VINTED" || input.channel === "CARDMARKET" || input.channel === "IN_PERSON") return "";
  return isGradedGrade(input.grade) ? "UK_RoyalMailSpecialDeliveryNextDay" : "UK_RoyalMailFirstClassStandard";
}

function buildCustomLabel(input: ListingPackInput): string {
  return [input.card.name, input.card.setName, input.card.number, gradeDisplay(input.grade) || "RAW"]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 80);
}
