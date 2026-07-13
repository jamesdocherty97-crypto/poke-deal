export type HoldingItem = {
  id: string;
  grade: string;
  quantity: number;
  costBasis: number;
  card: {
    id?: string;
    name: string;
    setName?: string | null;
    number?: string | null;
  };
};

export type InventoryHolding<T extends HoldingItem> = {
  key: string;
  items: T[];
  quantity: number;
  totalCostPence: number;
  averageUnitCostPence: number;
};

export function groupInventoryHoldings<T extends HoldingItem>(items: readonly T[]): InventoryHolding<T>[] {
  const groups = new Map<string, InventoryHolding<T>>();
  for (const item of items) {
    const cardKey = item.card.id || [item.card.name, item.card.setName, item.card.number]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .join("|");
    const key = `${cardKey}|${item.grade}`;
    const current = groups.get(key) ?? { key, items: [], quantity: 0, totalCostPence: 0, averageUnitCostPence: 0 };
    current.items.push(item);
    current.quantity += item.quantity;
    current.totalCostPence += item.costBasis * item.quantity;
    current.averageUnitCostPence = current.quantity > 0 ? Math.round(current.totalCostPence / current.quantity) : 0;
    groups.set(key, current);
  }
  return [...groups.values()];
}
