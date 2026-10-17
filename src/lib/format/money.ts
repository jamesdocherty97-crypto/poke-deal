declare const gbpPenceBrand: unique symbol;

/**
 * Integer GBP pence. A `GbpPence` may be used as a `number`.
 * A plain `number` is not a `GbpPence` until `gbpPence` accepts it.
 */
export type GbpPence = number & { readonly [gbpPenceBrand]: "GBP pence" };

/** Fail closed unless `value` is already an integer penny amount. */
export function gbpPence(value: number): GbpPence {
  if (!Number.isSafeInteger(value)) {
    throw new Error("GBP pence must be a safe integer");
  }
  return value as GbpPence;
}

/**
 * Round a GBP major-unit amount to integer pence, half away from zero.
 * The extra 1e-9 corrects binary fractions such as 1.005 * 100 landing just under the next penny.
 */
export function roundHalfUpPence(gbp: number): GbpPence {
  if (!Number.isFinite(gbp)) throw new Error("Cannot round a non-finite GBP amount");
  const sign = gbp < 0 ? -1 : 1;
  return gbpPence(sign * Math.floor(Math.abs(gbp) * 100 + 0.5 + 1e-9));
}

/**
 * Form text in pounds, such as "12.50" or "£12.50", to integer pence.
 * Blank text is 0. Text that is not a finite number is 0 so an untouched field does not throw.
 */
export function poundsToPence(value: string): GbpPence {
  const normalized = value.replace(/[^0-9.-]/g, "");
  const pounds = Number(normalized);
  if (!Number.isFinite(pounds)) return gbpPence(0);
  return roundHalfUpPence(pounds);
}

export function penceToPounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

export function formatGbp(pence: number | null | undefined): string {
  const rounded = Number.isFinite(pence) ? Math.round(pence ?? 0) : 0;
  const sign = rounded < 0 ? "-" : "";
  return `${sign}£${(Math.abs(rounded) / 100).toFixed(2)}`;
}
