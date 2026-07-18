import { normalizeCatalogCardSearchInput } from "./cardSearch.js";
import { getSetById, resolveSetIdForCard } from "./setCatalog.js";
import type { CatalogCard } from "./types.js";
import type { CardRef } from "../domain/types.js";

const PROMO_PREFIX_BY_SET_ID: Record<string, string> = {
  svp: "SVP",
  mep: "MEP",
  swshp: "SWSH",
  smp: "SM",
  xyp: "XY",
  bwp: "BW",
  dpp: "DP",
  hsp: "HGSS",
};

export function buildPromoCatalogFallback(card: CardRef): CatalogCard | null {
  const normalized = normalizeCatalogCardSearchInput(card.name, card.setName);
  const name = normalized.name || card.name.trim();
  if (!name) return null;

  const requestedNumber = card.number ?? normalized.number;
  const setId = resolveSetIdForCard(card.setName ?? normalized.setName, requestedNumber);
  const prefix = setId ? PROMO_PREFIX_BY_SET_ID[setId] : undefined;
  if (!setId || !prefix) return null;

  const number = formatPromoNumber(requestedNumber, prefix);
  if (!number) return null;

  const set = getSetById(setId);
  const providerId = `${setId}-${stripPromoNumber(number, prefix)}`;
  return {
    game: "POKEMON",
    language: "EN",
    name,
    setName: set?.name ?? card.setName ?? normalized.setName ?? `${prefix} Promos`,
    setCode: setId,
    number,
    rarity: "Promo",
    tcgApiId: providerId,
  };
}

function formatPromoNumber(value: string | undefined, prefix: string): string | null {
  const cleaned = value?.trim().toUpperCase().replace(/\s+/g, "") ?? "";
  if (!cleaned) return null;
  const prefixed = cleaned.match(new RegExp(`^${prefix}(\\d{1,4})$`, "i"));
  if (prefixed?.[1]) return `${prefix}${prefixed[1].padStart(Math.max(3, prefixed[1].length), "0")}`;
  const plain = cleaned.match(/^0*(\d{1,4})$/);
  if (plain?.[1]) return `${prefix}${plain[1].padStart(3, "0")}`;
  return null;
}

function stripPromoNumber(number: string, prefix: string): string {
  return String(Number.parseInt(number.replace(new RegExp(`^${prefix}`, "i"), ""), 10));
}
