import { z } from "zod";

export const acquiredAtSchema = z.string().datetime({ offset: true }).refine(
  (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) <= new Date().toISOString().slice(0, 10),
  "Acquisition date must be a valid date no later than today.",
);

export function parseAcquisitionDate(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("acquired date must use YYYY-MM-DD");
  const date = new Date(`${text}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text || text > new Date().toISOString().slice(0, 10)) {
    throw new Error("acquired date must be a real date no later than today");
  }
  return date.toISOString();
}
