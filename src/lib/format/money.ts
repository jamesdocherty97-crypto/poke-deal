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

export const POUNDS_TOO_LARGE_MESSAGE = "Enter a smaller amount. This one is too large to record.";

export type PoundsParse =
  | { ok: true; pence: GbpPence }
  | { ok: false; message: string };

/**
 * Form text in pounds, such as "12.50" or "£12.50", to integer pence.
 * Blank text and text that is not a number are 0 so an untouched field does not throw.
 * Amounts that cannot be a safe integer pence are invalid. This never throws:
 * sale and buy previews call it while rendering.
 */
export function poundsToPence(value: string): PoundsParse {
  const normalized = value.replace(/[^0-9.-]/g, "");
  if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") {
    return { ok: true, pence: gbpPence(0) };
  }
  const pounds = Number(normalized);
  if (Number.isNaN(pounds)) return { ok: true, pence: gbpPence(0) };
  if (!Number.isFinite(pounds)) return { ok: false, message: POUNDS_TOO_LARGE_MESSAGE };
  const sign = pounds < 0 ? -1 : 1;
  const rounded = sign * Math.floor(Math.abs(pounds) * 100 + 0.5 + 1e-9);
  if (!Number.isSafeInteger(rounded)) return { ok: false, message: POUNDS_TOO_LARGE_MESSAGE };
  return { ok: true, pence: rounded as GbpPence };
}

/** Pence for a preview, or null when the text is too large to record. */
export function readFormPence(value: string): GbpPence | null {
  const parsed = poundsToPence(value);
  return parsed.ok ? parsed.pence : null;
}

/** Message to show beside a money field, or null when the text can be used. */
export function poundsFieldMessage(value: string): string | null {
  const parsed = poundsToPence(value);
  return parsed.ok ? null : parsed.message;
}

export function penceToPounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

export function formatGbp(pence: number | null | undefined): string {
  const rounded = Number.isFinite(pence) ? Math.round(pence ?? 0) : 0;
  const sign = rounded < 0 ? "-" : "";
  return `${sign}£${(Math.abs(rounded) / 100).toFixed(2)}`;
}
