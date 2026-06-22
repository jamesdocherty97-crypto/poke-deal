export interface QuickHuntCard {
  name: string;
  setName: string;
  number: string;
  imageUrl?: string;
}

export const DEFAULT_QUICK_HUNTS: QuickHuntCard[] = [
  {
    name: "Charizard ex",
    setName: "151",
    number: "199/165",
    imageUrl: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
  },
  {
    name: "Pikachu ex",
    setName: "Surging Sparks",
    number: "238/191",
    imageUrl: "https://images.pokemontcg.io/sv8/238_hires.png",
  },
  {
    name: "Mew ex",
    setName: "Paldean Fates",
    number: "232/091",
    imageUrl: "https://images.pokemontcg.io/sv4pt5/232_hires.png",
  },
  {
    name: "Umbreon VMAX",
    setName: "Evolving Skies",
    number: "215/203",
    imageUrl: "https://images.pokemontcg.io/swsh7/215_hires.png",
  },
];

export function pinQuickHunt(
  current: readonly QuickHuntCard[],
  card: QuickHuntCard,
  maxCards = 6,
): QuickHuntCard[] {
  const normalized = normalizeQuickHunt(card);
  if (!normalized) return current.slice(0, maxCards);
  const key = quickHuntKey(normalized);
  const duplicate = current.find((row) => quickHuntKey(row) === key);
  const pinned =
    normalized.imageUrl || !duplicate?.imageUrl
      ? normalized
      : { ...normalized, imageUrl: duplicate.imageUrl };
  const withoutDuplicate = current.filter((row) => quickHuntKey(row) !== key);
  return [pinned, ...withoutDuplicate].slice(0, Math.max(1, maxCards));
}

export function removeQuickHunt(current: readonly QuickHuntCard[], card: QuickHuntCard): QuickHuntCard[] {
  const key = quickHuntKey(card);
  return current.filter((row) => quickHuntKey(row) !== key);
}

export function parseQuickHunts(value: string | null, fallback: readonly QuickHuntCard[] = DEFAULT_QUICK_HUNTS): QuickHuntCard[] {
  if (!value) return [...fallback];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [...fallback];
    const cards = parsed.map(normalizeQuickHunt).filter((card): card is QuickHuntCard => Boolean(card));
    return cards.length > 0 ? dedupeQuickHunts(cards).slice(0, 6) : [...fallback];
  } catch {
    return [...fallback];
  }
}

export function serializeQuickHunts(cards: readonly QuickHuntCard[]): string {
  return JSON.stringify(dedupeQuickHunts(cards).slice(0, 6));
}

function dedupeQuickHunts(cards: readonly QuickHuntCard[]): QuickHuntCard[] {
  const seen = new Set<string>();
  const result: QuickHuntCard[] = [];
  for (const card of cards) {
    const normalized = normalizeQuickHunt(card);
    if (!normalized) continue;
    const key = quickHuntKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeQuickHunt(value: unknown): QuickHuntCard | null {
  const row = value as Partial<QuickHuntCard> | null;
  const name = cleanText(row?.name);
  const setName = cleanText(row?.setName);
  const number = cleanText(row?.number);
  const imageUrl = cleanText(row?.imageUrl);
  if (!name || !setName || !number) return null;
  return imageUrl ? { name, setName, number, imageUrl } : { name, setName, number };
}

function quickHuntKey(card: QuickHuntCard): string {
  return `${card.name.toLowerCase()}|${card.setName.toLowerCase()}|${card.number.toLowerCase()}`;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
