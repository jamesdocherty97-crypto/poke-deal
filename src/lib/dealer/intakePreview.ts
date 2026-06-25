import type { ParsedQuickIntake } from "./intakeParser.js";

export type IntakePreviewTone = "good" | "warn" | "info";

export interface IntakePreviewChip {
  key: keyof ParsedQuickIntake;
  label: string;
  value: string;
  source: "typed" | "current";
}

export interface IntakePreviewOptions {
  currentName?: string;
  currentSetName?: string;
  currentNumber?: string;
  currentGrade?: string;
  currentCost?: string;
  currentQuantity?: string;
  currentSource?: string;
  currentLocation?: string;
  currentCondition?: string;
  currentChannel?: string;
  currentListingState?: string;
}

export interface IntakePreview {
  chips: IntakePreviewChip[];
  missing: string[];
  warnings: string[];
  readyForComp: boolean;
  readyForStock: boolean;
  tone: IntakePreviewTone;
  summary: string;
}

const fieldLabels: Record<keyof ParsedQuickIntake, string> = {
  name: "Card",
  setName: "Set",
  number: "No.",
  grade: "Grade",
  cost: "Cost",
  quantity: "Qty",
  source: "Source",
  location: "Place",
  condition: "Cond.",
  channel: "Channel",
  listingState: "Listing",
};

export function buildQuickIntakePreview(
  parsed: ParsedQuickIntake,
  options: IntakePreviewOptions = {},
): IntakePreview {
  const chips: IntakePreviewChip[] = [];
  addChip(chips, "name", parsed.name, options.currentName);
  addChip(chips, "setName", parsed.setName, options.currentSetName);
  addChip(chips, "number", parsed.number, options.currentNumber);
  addChip(chips, "grade", parsed.grade, options.currentGrade);
  addChip(chips, "cost", parsed.cost, options.currentCost);
  addChip(chips, "quantity", parsed.quantity, options.currentQuantity);
  addChip(chips, "source", parsed.source, options.currentSource);
  addChip(chips, "location", parsed.location, options.currentLocation);
  addChip(chips, "condition", parsed.condition, options.currentCondition);
  addChip(chips, "channel", parsed.channel, options.currentChannel);
  addChip(chips, "listingState", parsed.listingState, options.currentListingState);

  const effectiveName = firstText(parsed.name, options.currentName);
  const effectiveSet = firstText(parsed.setName, options.currentSetName);
  const effectiveNumber = firstText(parsed.number, options.currentNumber);
  const effectiveGrade = firstText(parsed.grade, options.currentGrade);
  const effectiveCost = firstText(parsed.cost, options.currentCost);
  const missing = [
    effectiveName ? null : "card",
    effectiveGrade ? null : "grade",
    effectiveCost ? null : "cost",
  ].filter((value): value is string => Boolean(value));
  const warnings = [
    effectiveSet || effectiveNumber ? null : "add set or number for a cleaner match",
  ].filter((value): value is string => Boolean(value));
  const readyForComp = Boolean(effectiveName && effectiveGrade);
  const readyForStock = readyForComp && Boolean(effectiveCost);
  const tone: IntakePreviewTone = readyForStock ? "good" : readyForComp ? "warn" : "info";

  return {
    chips,
    missing,
    warnings,
    readyForComp,
    readyForStock,
    tone,
    summary: previewSummary({ readyForComp, readyForStock, missing, warnings, chips }),
  };
}

function addChip(
  chips: IntakePreviewChip[],
  key: keyof ParsedQuickIntake,
  typedValue?: string,
  currentValue?: string,
) {
  const typed = firstText(typedValue);
  if (typed) {
    chips.push({ key, label: fieldLabels[key], value: displayChipValue(key, typed), source: "typed" });
    return;
  }

  const current = firstText(currentValue);
  if (current) chips.push({ key, label: fieldLabels[key], value: displayChipValue(key, current), source: "current" });
}

function previewSummary(input: {
  readyForComp: boolean;
  readyForStock: boolean;
  missing: string[];
  warnings: string[];
  chips: IntakePreviewChip[];
}): string {
  if (input.chips.length === 0) return "No card details detected yet.";
  if (input.readyForStock && input.warnings.length === 0) return "Ready to comp and stock.";
  if (input.readyForStock) return "Ready, but tighten the match.";
  if (input.readyForComp) return "Ready to comp; add cost before stocking.";
  return `Needs ${input.missing.join(", ")}.`;
}

function firstText(...values: Array<string | null | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function displayChipValue(key: keyof ParsedQuickIntake, value: string): string {
  if (key === "channel") {
    if (value === "EBAY") return "eBay";
    if (value === "CARDMARKET") return "Cardmarket";
    if (value === "VINTED") return "Vinted";
    if (value === "IN_PERSON") return "In person";
  }
  if (key === "listingState") {
    if (value === "DRAFT") return "Draft";
    if (value === "ACTIVE") return "Active";
  }
  return value;
}
