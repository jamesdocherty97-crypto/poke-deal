export interface VariantRequestText {
  name?: string | null;
  setName?: string | null;
  number?: string | null;
}

import type { CardFinish, PrintEdition } from "../domain/types.js";

export type CardVariantHint = PrintEdition | CardFinish;

export type CardPrintIdentity = {
  edition?: PrintEdition;
  finish?: CardFinish;
};

export function detectCardPrintIdentity(card: VariantRequestText): CardPrintIdentity {
  const text = [card.name, card.setName, card.number].map((value) => value?.toLowerCase() ?? "").join(" ");
  const edition: PrintEdition | undefined =
    /\b(?:1st|first)\s*(?:edition|ed)\b/.test(text) ? "FIRST_EDITION" :
      /\bshadowless\b/.test(text) ? "SHADOWLESS" :
        /\bstaff\b/.test(text) ? "STAFF" :
          /\bpre[\s-]?release\b/.test(text) ? "PRERELEASE" :
            /\bunlimited\b/.test(text) ? "UNLIMITED" : undefined;
  const finish: CardFinish | undefined =
    /\breverse[\s-]?holo(?:foil)?\b/.test(text) ? "REVERSE_HOLO" :
      /\bholo(?:foil)?\b/.test(text) && !/\bnormal\b/.test(text) ? "HOLO" :
        /\bnormal\b/.test(text) ? "NORMAL" : undefined;
  return { edition, finish };
}

export function detectCardVariantHint(card: VariantRequestText): CardVariantHint | null {
  const identity = detectCardPrintIdentity(card);
  return identity.edition ?? identity.finish ?? null;
}

export function addRequestedVariantHint(baseName: string, fallbackName: string): string {
  const hint = detectCardVariantHint({ name: fallbackName });
  if (!hint) return baseName;

  const target = hintToLabel(hint);
  if (!target) return baseName;
  const normalizedExisting = normalizeExistingVariantHint(baseName, hint);
  if (normalizedExisting !== baseName) return normalizedExisting;
  if (textMatchesVariant(baseName, target)) return baseName;
  if (hint === "FIRST_EDITION" && textMentionsFirstEdition(baseName)) return baseName;
  if (hint === "REVERSE_HOLO" && textMentionsReverseHolo(baseName)) return baseName;
  if (hint === "HOLO" && /\bholofoil\b/i.test(baseName)) return baseName;
  if (hint === "NORMAL" && /\bnormal\b/i.test(baseName)) return baseName;

  if (hint === "FIRST_EDITION" && textMentionsFirstEdition(fallbackName) && !textMentionsFirstEdition(baseName)) {
    return `${baseName} 1st Edition`;
  }

  if (baseName.trim() === "") return baseName;

  const separator = textMatchesVariant(baseName, "Reverse") && hint === "REVERSE_HOLO" ? " " : " ";
  if (!target) return baseName;
  return `${baseName}${separator}${target}`;
}

/** Reattaches both independent print dimensions after lookup-noise normalization. */
export function addRequestedPrintHints(baseName: string, fallback: VariantRequestText): string {
  const identity = detectCardPrintIdentity(fallback);
  let value = baseName;
  for (const hint of [identity.edition, identity.finish]) {
    if (hint) value = addSingleHint(value, hint);
  }
  return value;
}

function addSingleHint(value: string, hint: CardVariantHint): string {
  const target = hintToLabel(hint);
  if (!target || !value.trim()) return value;
  const normalized = normalizeExistingVariantHint(value, hint);
  if (normalized !== value || textMatchesVariant(value, target)) return normalized;
  return `${value} ${target}`;
}

function normalizeExistingVariantHint(value: string, hint: CardVariantHint): string {
  const target = hintToLabel(hint);
  if (!target) return value;

  const normalized = value.trim().replace(/\s+/g, " ");
  switch (hint) {
    case "REVERSE_HOLO":
      return normalized
        .replace(/\breverse[\s-]?holo(?:foil)?\b/gi, target)
        .replace(/\breverse\b(?!\s+holo(?:foil)?\b)/gi, target)
        .replace(new RegExp(`\\b${escapeRegExp(target)}\\s+${escapeRegExp(target)}\\b`, "gi"), target)
        .trim()
        .replace(/\s+/g, " ");

    case "HOLO":
      return normalized
        .replace(/\bholofoil\b/gi, target)
        .replace(/\bholo\b/gi, target)
        .replace(new RegExp(`\\b${escapeRegExp(target)}\\s+${escapeRegExp(target)}\\b`, "gi"), target)
        .trim()
        .replace(/\s+/g, " ");

    case "NORMAL":
      return normalized
        .replace(/\bnormal\b/gi, target)
        .replace(new RegExp(`\\b${escapeRegExp(target)}\\s+${escapeRegExp(target)}\\b`, "gi"), target)
        .trim()
        .replace(/\s+/g, " ");

    case "FIRST_EDITION":
      return normalized
        .replace(/\b1st\s*(?:edition|ed)\b/gi, target)
        .replace(/\bfirst\s*(?:edition|ed)\b/gi, target)
        .replace(new RegExp(`\\b${escapeRegExp(target)}\\s+${escapeRegExp(target)}\\b`, "gi"), target)
        .trim()
        .replace(/\s+/g, " ");

    case "SHADOWLESS":
    case "STAFF":
    case "PRERELEASE":
    case "UNLIMITED":
      return normalized
        .replace(new RegExp(`\\b${escapeRegExp(target)}\\b`, "gi"), target)
        .trim()
        .replace(/\s+/g, " ");

    default:
      return normalized;
  }
}

function textMatchesVariant(value: string, target: string): boolean {
  return new RegExp(`\\b${escapeRegExp(target)}\\b`, "i").test(value);
}

export function requestsFirstEdition(card: VariantRequestText): boolean {
  return detectCardVariantHint(card) === "FIRST_EDITION";
}

export function requestsReverseHolo(card: VariantRequestText): boolean {
  return detectCardVariantHint(card) === "REVERSE_HOLO";
}

export function requestsHolo(card: VariantRequestText): boolean {
  return detectCardVariantHint(card) === "HOLO";
}

export function requestsNormal(card: VariantRequestText): boolean {
  return detectCardVariantHint(card) === "NORMAL";
}

export function textMentionsFirstEdition(value: string | null | undefined): boolean {
  return /\b(?:1st|first)\s*(?:edition|ed)\b/i.test(value ?? "");
}

export function textMentionsReverseHolo(value: string | null | undefined): boolean {
  return /\breverse\s+holo(?:foil)?\b|\breverse-holofoil\b/i.test(value ?? "");
}

function hintToLabel(hint: CardVariantHint): string | null {
  switch (hint) {
    case "FIRST_EDITION":
      return "1st Edition";
    case "SHADOWLESS":
      return "Shadowless";
    case "STAFF":
      return "Staff";
    case "PRERELEASE":
      return "Prerelease";
    case "UNLIMITED":
      return "Unlimited";
    case "REVERSE_HOLO":
      return "Reverse Holo";
    case "HOLO":
      return "Holofoil";
    case "NORMAL":
      return "Normal";
    default:
      return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
