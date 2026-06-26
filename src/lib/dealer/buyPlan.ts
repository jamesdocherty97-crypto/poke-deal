import { defaultGrossSalePence, estimateSaleCosts, type SaleChannel } from "./saleFees.js";

export type BuyPlanTone = "good" | "warn" | "danger";

export interface BuyPlanInput {
  unitCostPence: number;
  quantity: number;
  listPricePence: number;
  channel: SaleChannel;
  grade?: string | null;
  cautious?: boolean;
  minRoiPct?: number;
}

export interface BuyPlan {
  label: "Buy" | "Check" | "Tight" | "Pass";
  tone: BuyPlanTone;
  unitListPence: number;
  unitFeesPence: number;
  unitPostagePence: number;
  unitNetPence: number;
  unitProfitPence: number;
  totalProfitPence: number;
  roiPct: number | null;
  marginPct: number | null;
  note: string;
  unitGrossSalePence: number;
}

export interface BuyTargetSuggestionInput {
  targetBuyPence?: number | null;
  compMedianPence: number;
  compLowPence?: number | null;
  currentTargetPence?: number | null;
}

export interface BuyTargetSuggestion {
  label: "Target buy" | "Safe target" | "70% comp" | "Low comp";
  targetPence: number;
  note: string;
  alreadyUsing: boolean;
}

export function buildBuyPlan(input: BuyPlanInput): BuyPlan {
  const unitCostPence = Math.max(0, Math.round(input.unitCostPence));
  const quantity = Math.max(1, Math.round(input.quantity));
  const unitListPence = Math.max(0, Math.round(input.listPricePence));
  const unitGrossSalePence = defaultGrossSalePence(input.channel, unitListPence, { grade: input.grade });
  const costs = estimateSaleCosts(input.channel, unitGrossSalePence, { grade: input.grade });
  const unitNetPence = unitGrossSalePence - costs.feesPence - costs.postagePence;
  const unitProfitPence = unitNetPence - unitCostPence;
  const roiPct = unitCostPence > 0 ? roundPct(unitProfitPence / unitCostPence) : null;
  const marginPct = unitGrossSalePence > 0 ? roundPct(unitProfitPence / unitGrossSalePence) : null;
  const minRoiPct = input.minRoiPct ?? 25;

  if (unitListPence <= 0 || unitProfitPence <= 0) {
    return {
      label: "Pass",
      tone: "danger",
      unitListPence,
      unitFeesPence: costs.feesPence,
      unitPostagePence: costs.postagePence,
      unitNetPence,
      unitProfitPence,
      totalProfitPence: unitProfitPence * quantity,
      roiPct,
      marginPct,
      unitGrossSalePence,
      note: "The planned sale price does not clear cost, fees and postage.",
    };
  }

  if (input.cautious) {
    return {
      label: "Check",
      tone: "warn",
      unitListPence,
      unitFeesPence: costs.feesPence,
      unitPostagePence: costs.postagePence,
      unitNetPence,
      unitProfitPence,
      totalProfitPence: unitProfitPence * quantity,
      roiPct,
      marginPct,
      unitGrossSalePence,
      note: "Maths works, but the comp needs a second look before committing hard.",
    };
  }

  if (roiPct != null && roiPct < minRoiPct) {
    return {
      label: "Tight",
      tone: "warn",
      unitListPence,
      unitFeesPence: costs.feesPence,
      unitPostagePence: costs.postagePence,
      unitNetPence,
      unitProfitPence,
      totalProfitPence: unitProfitPence * quantity,
      roiPct,
      marginPct,
      unitGrossSalePence,
      note: `Profit is positive but below the ${minRoiPct}% ROI target.`,
    };
  }

  return {
    label: "Buy",
    tone: "good",
    unitListPence,
    unitFeesPence: costs.feesPence,
    unitPostagePence: costs.postagePence,
    unitNetPence,
    unitProfitPence,
    totalProfitPence: unitProfitPence * quantity,
    roiPct,
    marginPct,
    unitGrossSalePence,
    note: "Planned sale clears costs with a useful margin.",
  };
}

export function buildBuyTargetSuggestion(input: BuyTargetSuggestionInput): BuyTargetSuggestion | null {
  return buildBuyTargetOptions(input)[0] ?? null;
}

export function buildBuyTargetOptions(input: BuyTargetSuggestionInput): BuyTargetSuggestion[] {
  const currentTargetPence = sanitisePence(input.currentTargetPence ?? 0);
  const targetBuyPence = sanitisePence(input.targetBuyPence ?? 0);
  const compMedianPence = sanitisePence(input.compMedianPence);
  const compLowPence = sanitisePence(input.compLowPence ?? 0);
  const options: BuyTargetSuggestion[] = [];

  if (targetBuyPence > 0) {
    options.push({
      label: "Target buy",
      targetPence: targetBuyPence,
      note: "Keeps a 30% safety cushion after expected selling costs.",
      alreadyUsing: isSamePence(currentTargetPence, targetBuyPence),
    });
    options.push({
      label: "Safe target",
      targetPence: Math.max(1, Math.round(targetBuyPence * 0.9)),
      note: "A little under target for quicker sourcing decisions.",
      alreadyUsing: isSamePence(currentTargetPence, Math.max(1, Math.round(targetBuyPence * 0.9))),
    });
  }

  if (compMedianPence > 0) {
    const targetPence = Math.round(compMedianPence * 0.7);
    options.push({
      label: "70% comp",
      targetPence,
      note: "Fallback target when fee-aware deal maths is not available.",
      alreadyUsing: isSamePence(currentTargetPence, targetPence),
    });
  }

  if (compLowPence > 0) {
    options.push({
      label: "Low comp",
      targetPence: compLowPence,
      note: "Anchors to the low end of recent sold evidence.",
      alreadyUsing: isSamePence(currentTargetPence, compLowPence),
    });
  }

  const seen = new Set<number>();
  return options.filter((option) => {
    if (seen.has(option.targetPence)) return false;
    seen.add(option.targetPence);
    return option.targetPence > 0;
  });
}

function roundPct(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

function sanitisePence(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function isSamePence(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1;
}
