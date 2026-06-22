export type InventorySwipeAction = "sell" | "delete";

export const INVENTORY_SWIPE_THRESHOLD_PX = 74;
export const INVENTORY_SWIPE_MAX_OFFSET_PX = 88;

export function inventorySwipeOffset(deltaX: number, deltaY: number): number {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return 0;
  if (Math.abs(deltaX) < 10) return 0;
  if (Math.abs(deltaY) > Math.abs(deltaX) * 0.72) return 0;

  const damped = Math.round(deltaX * 0.62);
  return clamp(damped, -INVENTORY_SWIPE_MAX_OFFSET_PX, INVENTORY_SWIPE_MAX_OFFSET_PX);
}

export function inventorySwipeAction(
  deltaX: number,
  deltaY: number,
  options: { canSell?: boolean } = {},
): InventorySwipeAction | null {
  if (Math.abs(deltaY) > Math.abs(deltaX) * 0.72) return null;
  if (deltaX >= INVENTORY_SWIPE_THRESHOLD_PX && options.canSell !== false) return "sell";
  if (deltaX <= -INVENTORY_SWIPE_THRESHOLD_PX) return "delete";
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
