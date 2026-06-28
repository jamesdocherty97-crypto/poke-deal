export interface VariantRequestText {
  name?: string | null;
  setName?: string | null;
  number?: string | null;
}

export type CardVariantHint = "FIRST_EDITION" | "REVERSE_HOLO" | "HOLO" | "NORMAL";

export function detectCardVariantHint(card: VariantRequestText): CardVariantHint | null {
  const tokens = [card.name, card.setName, card.number].map((value) => value?.toLowerCase() ?? "");

  if (tokens.some((text) => text.includes("1st") && text.includes("edition"))) {
    return "FIRST_EDITION";
  }

  const anyText = tokens.join(" ");
  if (/\breverse\s+holo(?:foil)?\b|\breverse-holofoil\b/.test(anyText)) {
    return "REVERSE_HOLO";
  }

  if (/\bholo(?:foil)?\b/.test(anyText) && !/\bnormal\b/.test(anyText)) {
    return "HOLO";
  }

  if (/\bnormal\b/.test(anyText)) {
    return "NORMAL";
  }

  return null;
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
