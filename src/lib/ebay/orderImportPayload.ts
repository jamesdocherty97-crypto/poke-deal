import { isDeepStrictEqual } from "node:util";

// The only provider fields an EbayOrderImport payload may keep. eBay's full
// order object carries buyer account, contact and address data; the ledger
// needs none of it, so imports and the one-off legacy scrub both persist this
// allowlisted projection and nothing else.
const ORDER_FIELDS = ["orderId", "creationDate", "lastModifiedDate", "orderPaymentStatus", "orderFulfillmentStatus"] as const;
const LINE_FIELDS = ["lineItemId", "legacyItemId", "sku", "title", "quantity"] as const;
const HELD_MONEY_FIELDS = ["lineItemCost", "discountedLineItemCost", "total", "orderDeliveryCost", "orderDeliveryDiscount"] as const;
const DELIVERY_COST_FIELDS = ["shippingCost", "handlingCost", "importCharges", "discountAmount"] as const;

type Scalar = string | number;

export type MinimalOrderImportPayload = {
  schemaVersion: 1;
  order: Partial<Record<(typeof ORDER_FIELDS)[number], Scalar>>;
  line: Partial<Record<(typeof LINE_FIELDS)[number], Scalar>>;
  heldAmounts?: Record<string, unknown>;
};

export type OrderImportPayloadScrubPlan =
  | { kind: "keep" }
  | { kind: "rewrite"; payload: MinimalOrderImportPayload }
  | { kind: "clear" };

/** Buyer-free payload persisted for one imported order line. */
export function minimalOrderImportPayload(
  order: object,
  line: object,
  heldAmounts?: object,
): MinimalOrderImportPayload {
  const held = heldAmounts === undefined ? undefined : projectHeldAmounts(heldAmounts);
  return {
    schemaVersion: 1,
    order: pickScalars(order, ORDER_FIELDS),
    line: pickScalars(line, LINE_FIELDS),
    ...(held ? { heldAmounts: held } : {}),
  };
}

/**
 * Decide what a stored payload needs so it holds no buyer data. Payloads that
 * already match their own minimal projection are kept, which makes repeated
 * scrubs a no-op. Anything with no recognisable order or line fields is
 * cleared outright rather than guessed at.
 */
export function planOrderImportPayloadScrub(payload: unknown): OrderImportPayloadScrubPlan {
  if (payload === null || payload === undefined) return { kind: "keep" };
  if (!isRecord(payload)) return { kind: "clear" };

  const order = isRecord(payload.order) ? payload.order : {};
  const line = isRecord(payload.line) ? payload.line : {};
  const minimal = minimalOrderImportPayload(order, line, isRecord(payload.heldAmounts) ? payload.heldAmounts : undefined);
  if (Object.keys(minimal.order).length === 0 && Object.keys(minimal.line).length === 0) return { kind: "clear" };
  return isDeepStrictEqual(payload, minimal) ? { kind: "keep" } : { kind: "rewrite", payload: minimal };
}

function projectHeldAmounts(value: object): Record<string, unknown> | undefined {
  const source = value as Record<string, unknown>;
  const held: Record<string, unknown> = {};
  for (const field of HELD_MONEY_FIELDS) {
    const money = pickMoney(source[field]);
    if (money) held[field] = money;
  }
  const delivery = source.deliveryCost;
  if (isRecord(delivery) && DELIVERY_COST_FIELDS.some((field) => field in delivery)) {
    const nested: Record<string, unknown> = {};
    for (const field of DELIVERY_COST_FIELDS) {
      const money = pickMoney(delivery[field]);
      if (money) nested[field] = money;
    }
    held.deliveryCost = nested;
  } else {
    const money = pickMoney(delivery);
    if (money) held.deliveryCost = money;
  }
  return Object.keys(held).length > 0 ? held : undefined;
}

function pickMoney(value: unknown): { value?: string; currency?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const money: { value?: string; currency?: string } = {};
  if (typeof value.value === "string") money.value = value.value;
  if (typeof value.currency === "string") money.currency = value.currency;
  return Object.keys(money).length > 0 ? money : undefined;
}

// Scalars only: a nested object under an allowlisted name is never copied.
function pickScalars<K extends string>(value: object, fields: readonly K[]): Partial<Record<K, Scalar>> {
  const source = value as Record<string, unknown>;
  const picked: Partial<Record<K, Scalar>> = {};
  for (const field of fields) {
    const item = source[field];
    if (typeof item === "string" || (typeof item === "number" && Number.isFinite(item))) picked[field] = item;
  }
  return picked;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
