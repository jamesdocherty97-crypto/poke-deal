import { estimateSaleCosts, type SaleChannel } from "./saleFees.js";

export type BuyPlanTone = "good" | "warn" | "danger";

export interface BuyPlanInput {
  unitCostPence: number;
  quantity: number;
  listPricePence: number;
  channel: SaleChannel;
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
}

export function buildBuyPlan(input: BuyPlanInput): BuyPlan {
  const unitCostPence = Math.max(0, Math.round(input.unitCostPence));
  const quantity = Math.max(1, Math.round(input.quantity));
  const unitListPence = Math.max(0, Math.round(input.listPricePence));
  const costs = estimateSaleCosts(input.channel, unitListPence);
  const unitNetPence = unitListPence - costs.feesPence - costs.postagePence;
  const unitProfitPence = unitNetPence - unitCostPence;
  const roiPct = unitCostPence > 0 ? roundPct(unitProfitPence / unitCostPence) : null;
  const marginPct = unitListPence > 0 ? roundPct(unitProfitPence / unitListPence) : null;
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
    note: "Planned sale clears costs with a useful margin.",
  };
}

function roundPct(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}
