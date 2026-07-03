// The comp → inventory → pricing spine, as a service.
//
// Depends on a small InventoryRepo INTERFACE rather than Prisma directly, so it is
// testable in-memory now and backed by Postgres later (PrismaInventoryRepo) with
// zero changes to this logic. This is the seam between domain and persistence.

import type { CardRef, CompResult, Grade } from "../domain/types.js";
import { suggestListPrice, type PricingStrategy } from "../comps/pricing.js";

export interface InventoryItemDraft {
  card: CardRef;
  grade: Grade;
  quantity: number;
  costBasisPence: number;
  acquiredFrom?: string;
  location?: string;
  condition?: string;
  graderCert?: string;
  status: "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
}

export interface InventoryItemRecord extends InventoryItemDraft {
  id: string;
  createdAt: string;
}

export interface InventoryRepo {
  create(draft: InventoryItemDraft): Promise<InventoryItemRecord>;
  list(): Promise<InventoryItemRecord[]>;
}

export interface AcquireInput {
  card: CardRef;
  grade: Grade;
  costBasisPence: number;
  quantity?: number;
  acquiredFrom?: string;
  location?: string;
  condition?: string;
  graderCert?: string;
  comp: CompResult | null;
  strategy?: PricingStrategy;
  minMargin?: number;
}

export interface AcquireResult {
  item: InventoryItemRecord;
  suggestion: ReturnType<typeof suggestListPrice>;
}

/**
 * The flagship flow: take a card I've just bought + its comp, persist it as stock,
 * and compute the list price I should ask. Valuing and pricing are one pipeline.
 */
export async function acquireToInventory(
  repo: InventoryRepo,
  input: AcquireInput,
): Promise<AcquireResult> {
  const suggestion = suggestListPrice({
    comp: input.comp,
    strategy: input.strategy,
    costBasisPence: input.costBasisPence,
    minMargin: input.minMargin,
    condition: input.condition,
  });

  const item = await repo.create({
    card: input.card,
    grade: input.grade,
    quantity: input.quantity ?? 1,
    costBasisPence: input.costBasisPence,
    acquiredFrom: input.acquiredFrom,
    location: input.location,
    condition: input.condition,
    graderCert: input.graderCert,
    status: "IN_STOCK",
  });

  return { item, suggestion };
}

/** In-memory repo for demo/tests. PrismaInventoryRepo replaces this in the app. */
export class InMemoryInventoryRepo implements InventoryRepo {
  private items: InventoryItemRecord[] = [];
  private seq = 0;

  async create(draft: InventoryItemDraft): Promise<InventoryItemRecord> {
    const rec: InventoryItemRecord = {
      ...draft,
      id: `inv_${++this.seq}`,
      createdAt: new Date().toISOString(),
    };
    this.items.push(rec);
    return rec;
  }

  async list(): Promise<InventoryItemRecord[]> {
    return [...this.items];
  }
}
