export interface IntakeFormSnapshot {
  name: string;
  setName: string;
  number: string;
  cost: string;
  quantity: string;
}

export function parseIntakeQuantity(value: string): number | null {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  return quantity;
}

export function nextIntakeFormAfterStock(
  current: IntakeFormSnapshot,
  keepBuying: boolean,
): IntakeFormSnapshot {
  if (!keepBuying) return current;
  return {
    ...current,
    name: "",
    number: "",
    cost: "",
    quantity: "1",
  };
}
