export type SalePromptTone = "good" | "warn" | "info";
export type SalePromptAction = "paste-total" | "create-sale";

export interface SalePromptInput {
  salePricePence: number;
  netPence?: number | null;
  profitPence?: number | null;
  soldQuantity: number;
  nextSaleAvailable: boolean;
}

export interface SalePrompt {
  title: string;
  detail: string;
  cta: string;
  tone: SalePromptTone;
  action: SalePromptAction;
}

export function buildSalePrompt(input: SalePromptInput): SalePrompt {
  const salePricePence = Math.max(0, Math.round(input.salePricePence));
  const soldQuantity = Math.max(1, Math.floor(input.soldQuantity));

  if (salePricePence <= 0) {
    return {
      title: "Enter buyer total",
      detail: "Paste or enter the buyer-paid total, including postage when the marketplace charges it.",
      cta: "Paste total",
      tone: "info",
      action: "paste-total",
    };
  }

  const profit = Number.isFinite(input.profitPence ?? NaN) ? Math.round(input.profitPence!) : null;
  const net = Number.isFinite(input.netPence ?? NaN) ? Math.round(input.netPence!) : null;
  const quantityLabel = soldQuantity === 1 ? "1 card" : `${soldQuantity} cards`;
  const next = input.nextSaleAvailable ? " Save + next is available." : "";

  if (profit != null && profit < 0) {
    return {
      title: "Review loss",
      detail: `${quantityLabel} will book a ${formatSignedGbp(profit)} loss${net != null ? ` after ${formatSignedGbp(net)} net` : ""}.${next}`,
      cta: "Create sale",
      tone: "warn",
      action: "create-sale",
    };
  }

  return {
    title: "Ready to book",
    detail: `${quantityLabel}${profit != null ? ` · ${formatSignedGbp(profit)} profit` : ""}${net != null ? ` · ${formatSignedGbp(net)} net` : ""}.${next}`,
    cta: "Create sale",
    tone: "good",
    action: "create-sale",
  };
}

function formatSignedGbp(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const absolute = Math.abs(pence);
  return `${sign}£${(absolute / 100).toFixed(2)}`;
}
