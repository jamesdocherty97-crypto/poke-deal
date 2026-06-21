// The keystone contract. Every comp/price provider implements this.
// Adapters fetch raw sales from their API, then hand them to the cleaning
// engine. The rest of the app only ever sees a clean CompResult — so providers
// are swappable, and any one of them dying cannot break the app.

import type { CardRef, CompResult, CompQuery, Grade, RawSale } from "../domain/types.js";

export interface CompSource {
  /** Stable identifier, stored on persisted comps, e.g. "pokemon-price-tracker". */
  readonly name: string;

  /** True if real credentials are present; false means the source runs on fixtures. */
  readonly live: boolean;

  /**
   * Return a cleaned comp for the card+grade. Implementations MUST:
   *  - fetch raw sales for the card,
   *  - delegate cleaning to cleanToComp (do not reinvent stats),
   *  - never throw for "no data" — return a CompResult with sampleSize 0.
   */
  lookup(card: CardRef, query?: CompQuery): Promise<CompResult>;
}

/** Optional capability: a source that can also return the underlying raw sales. */
export interface RawSaleSource extends CompSource {
  fetchRawSales(card: CardRef, grade: Grade, windowDays: number): Promise<RawSale[]>;
}
