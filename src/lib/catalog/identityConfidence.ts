import { collectorNumbersEquivalent, normalizeSetNameForCompare } from "../cards/identity.js";
import type { CardRef } from "../domain/types.js";
import type { CatalogCard } from "./types.js";

export type IdentityConfidence = {
  level: "high" | "medium" | "low";
  score: number;
  autoSelectable: boolean;
  reasons: string[];
  conflicts: string[];
};

export function evaluateCatalogIdentity(request: CardRef, card: CatalogCard | null): IdentityConfidence {
  if (!card) return {
    level: "low",
    score: 0,
    autoSelectable: false,
    reasons: ["No catalog identity confirmed"],
    conflicts: ["catalog identity unavailable"],
  };
  let score = 0;
  const reasons: string[] = [];
  const conflicts: string[] = [];
  const requestSet = normalizeSetNameForCompare(request.setName);
  const cardSet = normalizeSetNameForCompare(card.setName);
  if (requestSet && cardSet) {
    if (requestSet === cardSet || requestSet.includes(cardSet) || cardSet.includes(requestSet)) {
      score += 25;
      reasons.push("set agrees");
    } else conflicts.push(`set conflict: ${request.setName} vs ${card.setName}`);
  }
  if (request.number && card.number) {
    if (collectorNumbersEquivalent(request.number, card.number)) {
      score += 35;
      reasons.push("collector number agrees");
    } else conflicts.push(`number conflict: ${request.number} vs ${card.number}`);
  }
  if ((request.language ?? "EN") === card.language) {
    score += 15;
    reasons.push(`${card.language} language agrees`);
  } else conflicts.push(`language conflict: ${request.language ?? "EN"} vs ${card.language}`);

  const providerCount = [card.tcgApiId, card.tcgDexId, card.cardmarketId].filter(Boolean).length;
  if (providerCount > 0) {
    score += providerCount >= 2 ? 15 : 10;
    reasons.push(`${providerCount} provider identity${providerCount === 1 ? "" : " IDs"} retained`);
  }
  if (request.edition) {
    if (card.edition === request.edition) {
      score += 15;
      reasons.push(`${request.edition.replace(/_/g, " ")} edition agrees`);
    } else conflicts.push(card.edition ? `edition conflict: ${request.edition} vs ${card.edition}` : `${request.edition.replace(/_/g, " ")} edition is not provider-confirmed`);
  }
  if (request.finish) {
    if (card.finish === request.finish) {
      score += 10;
      reasons.push(`${request.finish.replace(/_/g, " ")} finish agrees`);
    } else conflicts.push(card.finish ? `finish conflict: ${request.finish} vs ${card.finish}` : `${request.finish.replace(/_/g, " ")} finish is not provider-confirmed`);
  }
  if (!request.number) reasons.push("collector number not supplied");
  const level = conflicts.length > 0 ? "low" : score >= 75 ? "high" : score >= 45 ? "medium" : "low";
  return { level, score: Math.min(100, score), autoSelectable: conflicts.length === 0 && level !== "low", reasons, conflicts };
}
