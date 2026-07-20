import {
  collectorNumberCompareForms,
  normalizeCollectorNumberForCompare,
  normalizeSetNameForCompare,
} from "../cards/identity.js";

export type DuplicateCardCandidate = {
  id: string;
  game: string;
  language: string;
  name: string;
  setName: string;
  number: string | null;
  edition: string | null;
  finish: string | null;
};

export type DuplicateCardGrouping<T extends DuplicateCardCandidate> = {
  groups: T[][];
  conflicts: Array<{ reason: "conflicting-printed-totals"; members: T[] }>;
};

/**
 * Find only card identities that are safe to consolidate automatically.
 * A numerator-only provider row may join one printed-total identity, but it
 * may not bridge two different printed totals. Edition and finish are exact
 * boundaries because null means unknown, not permission to merge variants.
 */
export function groupDuplicateCardIdentities<T extends DuplicateCardCandidate>(cards: readonly T[]): DuplicateCardGrouping<T> {
  const buckets = new Map<string, T[]>();
  for (const card of cards) {
    const numberKey = collectorNumberFamilyKey(card.number);
    if (!numberKey) continue;
    const key = [
      card.game,
      card.language,
      normalizeSetNameForCompare(card.setName),
      normalizeCardNameForCompare(card.name),
      card.edition ?? "<null>",
      card.finish ?? "<null>",
      numberKey,
    ].join("\u0000");
    buckets.set(key, [...(buckets.get(key) ?? []), card]);
  }

  const groups: T[][] = [];
  const conflicts: DuplicateCardGrouping<T>["conflicts"] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const ordered = [...bucket].sort((left, right) => left.id.localeCompare(right.id));
    const printedTotals = new Set(
      ordered
        .map((card) => normalizeCollectorNumberForCompare(card.number))
        .filter((number): number is string => Boolean(number?.includes("/"))),
    );
    if (printedTotals.size > 1) {
      conflicts.push({ reason: "conflicting-printed-totals", members: ordered });
      continue;
    }
    groups.push(ordered);
  }
  return { groups, conflicts };
}

export function normalizeCardNameForCompare(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/♀/g, " female ")
    .replace(/♂/g, " male ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function hasPrintedCollectorTotal(value: string | null | undefined): boolean {
  return Boolean(normalizeCollectorNumberForCompare(value)?.includes("/"));
}

function collectorNumberFamilyKey(value: string | null | undefined): string | null {
  const forms = [...collectorNumberCompareForms(value)];
  if (forms.length === 0) return null;
  // The shortest compare form is the stable numerator/promo-prefixless key.
  return forms.sort((left, right) => left.length - right.length || left.localeCompare(right))[0] ?? null;
}
