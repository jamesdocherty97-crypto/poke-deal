import { formatGbp } from "../comps/currency.js";
import type { CompResult } from "../domain/types.js";

export interface WatchCheckInput {
  watchId: string;
  cardName: string;
  grade: string;
  targetPence: number;
  comp: CompResult;
}

export interface WatchHit {
  watchId: string;
  cardName: string;
  grade: string;
  targetPence: number;
  marketPence: number;
  sampleSize: number;
  windowDays: number;
  message: string;
}

export function checkWatch(input: WatchCheckInput): WatchHit | null {
  if (input.targetPence <= 0 || input.comp.sampleSize === 0 || input.comp.medianPence <= 0) return null;
  if (input.comp.medianPence > input.targetPence) return null;

  return {
    watchId: input.watchId,
    cardName: input.cardName,
    grade: input.grade,
    targetPence: input.targetPence,
    marketPence: input.comp.medianPence,
    sampleSize: input.comp.sampleSize,
    windowDays: input.comp.windowDays,
    message: `${input.cardName} ${input.grade.replace(/_/g, " ")} is at ${formatGbp(input.comp.medianPence)} vs target ${formatGbp(input.targetPence)} (${input.comp.sampleSize}/${input.comp.windowDays}d).`,
  };
}

export function formatWatchDigest(hits: WatchHit[]): string {
  if (hits.length === 0) return "No sourcing targets hit right now.";
  return hits.map((hit) => hit.message).join("\n");
}
