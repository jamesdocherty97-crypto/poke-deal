export interface QuickHuntCard {
  name: string;
  setName: string;
  number: string;
  imageUrl?: string;
  setMarkUrl?: string;
}

export const MAX_QUICK_HUNTS = 14;

export const DEFAULT_QUICK_HUNTS: QuickHuntCard[] = [
  {
    name: "Charizard ex",
    setName: "151",
    number: "199/165",
    imageUrl: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/sv3pt5/logo.png",
  },
  {
    name: "Pikachu ex",
    setName: "Surging Sparks",
    number: "238/191",
    imageUrl: "https://images.pokemontcg.io/sv8/238_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/sv8/logo.png",
  },
  {
    name: "Mew ex",
    setName: "Paldean Fates",
    number: "232/091",
    imageUrl: "https://images.pokemontcg.io/sv4pt5/232_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/sv4pt5/logo.png",
  },
  {
    name: "Umbreon VMAX",
    setName: "Evolving Skies",
    number: "215/203",
    imageUrl: "https://images.pokemontcg.io/swsh7/215_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/swsh7/logo.png",
  },
  {
    name: "Rayquaza VMAX",
    setName: "Evolving Skies",
    number: "218/203",
    imageUrl: "https://images.pokemontcg.io/swsh7/218_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/swsh7/logo.png",
  },
  {
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    number: "TG06/TG30",
    imageUrl: "https://images.pokemontcg.io/swsh11tg/TG06_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/swsh11tg/logo.png",
  },
  {
    name: "Greninja ex",
    setName: "Twilight Masquerade",
    number: "214/167",
    imageUrl: "https://images.pokemontcg.io/sv6/214_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/sv6/logo.png",
  },
  {
    name: "Magikarp",
    setName: "Paldea Evolved",
    number: "203/193",
    imageUrl: "https://images.pokemontcg.io/sv2/203_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/sv2/logo.png",
  },
  {
    name: "Giratina VSTAR",
    setName: "Crown Zenith Galarian Gallery",
    number: "GG69/GG70",
    imageUrl: "https://images.pokemontcg.io/swsh12pt5gg/GG69_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/swsh12pt5gg/logo.png",
  },
  {
    name: "Lugia V",
    setName: "Silver Tempest",
    number: "186/195",
    imageUrl: "https://images.pokemontcg.io/swsh12/186_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/swsh12/logo.png",
  },
  {
    name: "Giratina V",
    setName: "Lost Origin",
    number: "186/196",
    imageUrl: "https://images.pokemontcg.io/swsh11/186_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/swsh11/logo.png",
  },
  {
    name: "Pikachu with Grey Felt Hat",
    setName: "Scarlet & Violet Black Star Promos",
    number: "SVP085",
    imageUrl: "https://images.pokemontcg.io/svp/85_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/svp/logo.png",
  },
  {
    name: "Snivy",
    setName: "Mega Evolution Promos",
    number: "MEP049",
  },
  {
    name: "Charizard",
    setName: "Base",
    number: "4/102",
    imageUrl: "https://images.pokemontcg.io/base1/4_hires.png",
    setMarkUrl: "https://images.pokemontcg.io/base1/logo.png",
  },
];

export function pinQuickHunt(
  current: readonly QuickHuntCard[],
  card: QuickHuntCard,
  maxCards = MAX_QUICK_HUNTS,
): QuickHuntCard[] {
  const normalized = normalizeQuickHunt(card);
  if (!normalized) return current.slice(0, maxCards);
  const key = quickHuntKey(normalized);
  const duplicate = current.find((row) => quickHuntKey(row) === key);
  const imageUrl = normalized.imageUrl ?? duplicate?.imageUrl;
  const setMarkUrl = normalized.setMarkUrl ?? duplicate?.setMarkUrl;
  const pinned = {
    ...normalized,
    ...(imageUrl ? { imageUrl } : {}),
    ...(setMarkUrl ? { setMarkUrl } : {}),
  };
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
    return cards.length > 0 ? fillFromFallback(dedupeQuickHunts(cards), fallback).slice(0, MAX_QUICK_HUNTS) : [...fallback];
  } catch {
    return [...fallback];
  }
}

export function serializeQuickHunts(cards: readonly QuickHuntCard[]): string {
  return JSON.stringify(dedupeQuickHunts(cards).slice(0, MAX_QUICK_HUNTS));
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

function fillFromFallback(cards: readonly QuickHuntCard[], fallback: readonly QuickHuntCard[]): QuickHuntCard[] {
  const fallbackByKey = new Map(fallback.map((card) => [quickHuntKey(card), card]));
  return cards.map((card) => {
    const matched = fallbackByKey.get(quickHuntKey(card));
    const imageUrl = card.imageUrl ?? matched?.imageUrl;
    const setMarkUrl = card.setMarkUrl ?? matched?.setMarkUrl;
    return {
      ...card,
      ...(imageUrl ? { imageUrl } : {}),
      ...(setMarkUrl ? { setMarkUrl } : {}),
    };
  });
}

function normalizeQuickHunt(value: unknown): QuickHuntCard | null {
  const row = value as Partial<QuickHuntCard> | null;
  const name = cleanText(row?.name);
  const setName = cleanText(row?.setName);
  const number = cleanText(row?.number);
  const imageUrl = cleanText(row?.imageUrl);
  const setMarkUrl = cleanText(row?.setMarkUrl);
  if (!name || !setName || !number) return null;
  return {
    name,
    setName,
    number,
    ...(imageUrl ? { imageUrl } : {}),
    ...(setMarkUrl ? { setMarkUrl } : {}),
  };
}

function quickHuntKey(card: QuickHuntCard): string {
  return `${card.name.toLowerCase()}|${card.setName.toLowerCase()}|${card.number.toLowerCase()}`;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
