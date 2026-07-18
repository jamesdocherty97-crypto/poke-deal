import type { CatalogCard } from "../catalog/types.js";
import type { CardRef, Grade } from "../domain/types.js";
import type { CompCardImageEvidence } from "./cardArt.js";
import type { CompSourceProgress, ReconciledComp } from "./compService.js";
import type { EbayAskEvidence } from "../ebay/browseAsks.js";
import type { IdentityConfidence } from "../catalog/identityConfidence.js";

export const COMP_PROGRESS_VERSION = 1 as const;

export interface AppCompReceipt extends ReconciledComp {
  catalog: CatalogCard | null;
  alternatives: CatalogCard[];
  ambiguous: boolean;
  psaCert: unknown | null;
  cardImage: CompCardImageEvidence;
  askEvidence: EbayAskEvidence;
  identityConfidence: IdentityConfidence;
}

type CompProgressBase<T extends string> = {
  version: typeof COMP_PROGRESS_VERSION;
  type: T;
  lookupId: string;
  sequence: number;
  emittedAt: string;
};

export type CompCatalogEvent = CompProgressBase<"catalog"> & {
  requested: CardRef;
  identity: CardRef;
  grade: Grade;
  catalog: CatalogCard | null;
  ambiguity: "pending" | boolean;
  sources: Array<{ name: string; live: boolean }>;
  identityConfidence?: IdentityConfidence;
};

export type CompSourceEvent = CompProgressBase<"source"> & CompSourceProgress;

export type CompVerdictEvent = CompProgressBase<"verdict"> & {
  phase: "provisional" | "quorum";
  ambiguity: "pending" | boolean;
  pricedSourceCount: number;
  /** Never a bare number: complete evidence + reconciliation receipt. */
  receipt: ReconciledComp;
};

export type CompReceiptEvent = CompProgressBase<"receipt"> & {
  latencyMs: number;
  receipt: AppCompReceipt;
};

export type CompErrorEvent = CompProgressBase<"error"> & {
  status: number;
  error: string;
};

export type CompProgressEvent =
  | CompCatalogEvent
  | CompSourceEvent
  | CompVerdictEvent
  | CompReceiptEvent
  | CompErrorEvent;

export type CompProgressEventInput = CompProgressEvent extends infer Event
  ? Event extends CompProgressEvent
    ? Omit<Event, "version" | "lookupId" | "sequence" | "emittedAt">
    : never
  : never;

export interface CompProgressEventFactory {
  readonly lookupId: string;
  next(event: CompProgressEventInput): CompProgressEvent;
}

export function createCompProgressEventFactory(options: {
  lookupId?: string;
  now?: () => Date;
} = {}): CompProgressEventFactory {
  const lookupId = options.lookupId ?? crypto.randomUUID();
  const now = options.now ?? (() => new Date());
  let sequence = 0;
  return {
    lookupId,
    next(event) {
      sequence += 1;
      return {
        ...event,
        version: COMP_PROGRESS_VERSION,
        lookupId,
        sequence,
        emittedAt: now().toISOString(),
      } as CompProgressEvent;
    },
  };
}

export function encodeCompProgressEvent(event: CompProgressEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export function parseCompProgressNdjson(value: string): CompProgressEvent[] {
  return value
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CompProgressEvent);
}

export function pricedSourceCount(receipt: ReconciledComp): number {
  return new Set(
    receipt.all
      .filter((result) => result.sampleSize > 0 && result.medianPence > 0)
      .map((result) => result.source),
  ).size;
}
