export function formatGbp(pence: number | null | undefined): string {
  const rounded = Number.isFinite(pence) ? Math.round(pence ?? 0) : 0;
  const sign = rounded < 0 ? "-" : "";
  return `${sign}£${(Math.abs(rounded) / 100).toFixed(2)}`;
}
