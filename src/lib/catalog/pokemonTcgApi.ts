import type { CardRef } from "../domain/types.js";
import type { CatalogCard, CatalogSource } from "./types.js";

const BASE_URL = "https://api.pokemontcg.io/v2";
const SELECT_FIELDS = "id,name,number,rarity,images,set";

type FetchLike = typeof fetch;

type PokemonTcgSet = {
  id?: unknown;
  name?: unknown;
  printedTotal?: unknown;
  total?: unknown;
  images?: { symbol?: unknown; logo?: unknown };
};

type PokemonTcgCardPayload = {
  id?: unknown;
  name?: unknown;
  number?: unknown;
  rarity?: unknown;
  images?: { small?: unknown; large?: unknown };
  set?: PokemonTcgSet;
};

export class PokemonTcgApiCatalogSource implements CatalogSource {
  readonly name = "pokemon-tcg-api";
  readonly live: boolean;

  constructor(
    private readonly apiKey: string | undefined = process.env.POKEMON_TCG_API_KEY,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl: string = BASE_URL,
  ) {
    this.live = Boolean(apiKey?.trim());
  }

  async resolve(card: CardRef): Promise<CatalogCard | null> {
    if ((card.game && card.game !== "POKEMON") || (card.language && card.language !== "EN")) {
      return null;
    }

    if (card.tcgApiId) {
      const json = await this.request(`/cards/${encodeURIComponent(card.tcgApiId)}`, {
        select: SELECT_FIELDS,
      });
      return mapPokemonTcgCard(readDataObject(json));
    }

    const q = buildPokemonTcgSearchQuery(card);
    if (!q) return null;

    const json = await this.request("/cards", {
      q,
      pageSize: "10",
      select: SELECT_FIELDS,
    });
    return pickBestPokemonTcgCard(readDataArray(json), card);
  }

  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    try {
      const url = new URL(`${this.baseUrl}${path}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.apiKey?.trim()) {
        headers["X-Api-Key"] = this.apiKey.trim();
      }

      const res = await this.fetchImpl(url, { headers });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }
}

export function buildPokemonTcgSearchQuery(card: CardRef): string {
  const terms: string[] = [];
  const name = card.name.trim();
  if (name) terms.push(`name:${quoteQueryValue(name)}`);

  const number = normalizeCollectorNumber(card.number);
  if (number) terms.push(`number:${quoteQueryValue(number)}`);

  const setName = card.setName?.trim();
  if (setName) terms.push(`set.name:${quoteQueryValue(setName)}`);

  return terms.join(" ");
}

export function mapPokemonTcgCard(card: unknown): CatalogCard | null {
  const payload = card as PokemonTcgCardPayload | null;
  const id = readString(payload?.id);
  const name = readString(payload?.name);
  const setName = readString(payload?.set?.name);
  if (!id || !name || !setName) return null;

  const apiNumber = readString(payload?.number);
  const printedTotal = readPositiveInt(payload?.set?.printedTotal) ?? readPositiveInt(payload?.set?.total);
  const number = apiNumber ? formatCollectorNumber(apiNumber, printedTotal) : undefined;

  return {
    game: "POKEMON",
    language: "EN",
    name,
    setName,
    setCode: readString(payload?.set?.id),
    number,
    rarity: readString(payload?.rarity),
    imageUrl: readString(payload?.images?.large) ?? readString(payload?.images?.small),
    setLogoUrl: readString(payload?.set?.images?.logo),
    setSymbolUrl: readString(payload?.set?.images?.symbol),
    tcgApiId: id,
  };
}

export function pickBestPokemonTcgCard(cards: unknown[], target: CardRef): CatalogCard | null {
  const mapped = cards
    .map(mapPokemonTcgCard)
    .filter((card): card is CatalogCard => card != null);
  if (mapped.length === 0) return null;

  return mapped.reduce((best, card) =>
    scoreCatalogCard(card, target) > scoreCatalogCard(best, target) ? card : best,
  );
}

export function normalizeCollectorNumber(number: string | undefined): string | undefined {
  const trimmed = number?.trim();
  if (!trimmed) return undefined;
  return trimmed.split("/")[0]?.trim() || trimmed;
}

function formatCollectorNumber(number: string, printedTotal: number | undefined): string {
  if (number.includes("/") || !printedTotal) return number;
  return `${number}/${printedTotal}`;
}

function scoreCatalogCard(card: CatalogCard, target: CardRef): number {
  let score = 0;
  if (sameText(card.tcgApiId, target.tcgApiId)) score += 100;
  if (sameText(card.name, target.name)) score += 50;

  const targetNumber = normalizeCollectorNumber(target.number);
  const cardNumber = normalizeCollectorNumber(card.number);
  if (targetNumber && sameText(cardNumber, targetNumber)) score += 30;

  const setName = target.setName?.trim();
  if (setName) {
    if (sameText(card.setName, setName) || sameText(card.setCode, setName)) {
      score += 25;
    } else if (includesText(card.setName, setName)) {
      score += 10;
    }
  }

  return score;
}

function quoteQueryValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function readDataObject(json: unknown): unknown {
  const root = json as { data?: unknown } | null;
  return root?.data ?? null;
}

function readDataArray(json: unknown): unknown[] {
  const root = json as { data?: unknown } | null;
  return Array.isArray(root?.data) ? root.data : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : undefined;
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  return a != null && b != null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function includesText(haystack: string | undefined, needle: string): boolean {
  return haystack?.toLowerCase().includes(needle.toLowerCase()) ?? false;
}
