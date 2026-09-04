export interface OfflineSaleStock {
  id: string;
  quantity: number;
  status?: string;
  updatedAt?: string;
}

export interface OfflineSaleReservation {
  id: string;
  kind: string;
  endpoint: string;
  body?: unknown;
  summary?: { quantity?: number };
  saleStock?: OfflineSaleStock;
  syncedAt?: string | null;
  stockAfterSync?: OfflineSaleStock;
}

export function offlineSaleItemId(mutation: OfflineSaleReservation): string | null {
  if (mutation.kind !== "mark-sold") return null;
  const match = /^\/api\/inventory\/([^/?]+)\/sell$/.exec(mutation.endpoint);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export function offlineSaleQuantity(mutation: OfflineSaleReservation): number {
  const body = mutation.body && typeof mutation.body === "object" ? mutation.body as { quantity?: unknown } : null;
  const quantity = Number(body?.quantity ?? mutation.summary?.quantity ?? 1);
  // A malformed legacy sale must never make stock appear available to sell again.
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : Number.MAX_SAFE_INTEGER;
}

/** Availability on this device only; queued sales do not change the profit ledger. */
export function availableOfflineSaleQuantity(item: OfflineSaleStock, mutations: readonly OfflineSaleReservation[]): number {
  let available = stockQuantity(item);
  let version = versionAt(item.updatedAt);
  let reserved = 0;
  for (const mutation of mutations) {
    if (offlineSaleItemId(mutation) !== item.id) continue;
    const confirmed = mutation.syncedAt ? mutation.stockAfterSync : undefined;
    if (!confirmed || confirmed.id !== item.id) {
      reserved += offlineSaleQuantity(mutation);
      continue;
    }
    const confirmedVersion = versionAt(confirmed.updatedAt);
    if (!confirmedVersion || !version) {
      // Old cached stock without a version cannot supersede a confirmed sale.
      available = Math.min(available, stockQuantity(confirmed));
    } else if (confirmedVersion > version) {
      available = stockQuantity(confirmed);
      version = confirmedVersion;
    } else if (confirmedVersion === version) {
      available = Math.min(available, stockQuantity(confirmed));
    }
  }
  return Math.max(0, available - reserved);
}

export function readOfflineSaleStock(payload: unknown): OfflineSaleStock | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const item = (payload as { item?: unknown }).item;
  if (!item || typeof item !== "object") return undefined;
  const value = item as Record<string, unknown>;
  if (typeof value.id !== "string" || !Number.isSafeInteger(value.quantity) || Number(value.quantity) < 0) return undefined;
  if (typeof value.status !== "string" || !["IN_STOCK", "LISTED", "RESERVED", "SOLD"].includes(value.status)) return undefined;
  return {
    id: value.id,
    quantity: Number(value.quantity),
    status: value.status,
    ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
  };
}

function stockQuantity(item: OfflineSaleStock): number {
  return item.status === "SOLD" || !Number.isSafeInteger(item.quantity) ? 0 : Math.max(0, item.quantity);
}

function versionAt(value?: string): number {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}
