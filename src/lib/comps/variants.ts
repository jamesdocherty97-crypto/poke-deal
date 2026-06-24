export interface VariantRequestText {
  name?: string | null;
  setName?: string | null;
  number?: string | null;
}

export function requestsFirstEdition(card: VariantRequestText): boolean {
  return [card.name, card.setName, card.number].some((value) => textMentionsFirstEdition(value));
}

export function textMentionsFirstEdition(value: string | null | undefined): boolean {
  return /\b(?:1st|first)\s*(?:edition|ed)\b/i.test(value ?? "");
}
