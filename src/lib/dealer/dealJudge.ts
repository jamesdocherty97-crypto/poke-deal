import { conditionAdjustedPricePence } from "../comps/pricing.js";
import type { CompResult } from "../domain/types.js";
import { defaultGrossSalePence, estimateSaleCosts, type SaleChannel } from "./saleFees.js";

export interface DealJudgeResult {
  label: "Buy" | "Watch" | "Pass" | "Max offer" | "No signal";
  tone: "good" | "warn" | "danger";
  expectedProfitPence: number;
  targetBuyPence: number;
}

export function judgeDeal(
  comp: Pick<CompResult, "medianPence" | "sampleSize">,
  costBasisPence: number,
  channel: SaleChannel,
  grade: string,
  condition: string | null | undefined,
): DealJudgeResult {
  if (comp.sampleSize === 0 || comp.medianPence <= 0) {
    return { label: "No signal", tone: "danger", expectedProfitPence: 0, targetBuyPence: 0 };
  }

  const adjustedCompPence = conditionAdjustedPricePence(comp.medianPence, grade, condition);
  const grossSalePence = defaultGrossSalePence(channel, adjustedCompPence, { grade });
  const costs = estimateSaleCosts(channel, grossSalePence, { grade });
  const net = grossSalePence - costs.feesPence - costs.postagePence;
  const targetBuyPence = Math.max(0, Math.round(net * 0.7));

  if (costBasisPence <= 0) {
    return { label: "Max offer", tone: "warn", expectedProfitPence: 0, targetBuyPence };
  }

  const expectedProfitPence = net - costBasisPence;
  const roi = expectedProfitPence / costBasisPence;
  if (expectedProfitPence > 0 && roi >= 0.35 && comp.sampleSize >= 3) {
    return { label: "Buy", tone: "good", expectedProfitPence, targetBuyPence };
  }
  if (expectedProfitPence > 0 && roi >= 0.1) {
    return { label: "Watch", tone: "warn", expectedProfitPence, targetBuyPence };
  }
  return { label: "Pass", tone: "danger", expectedProfitPence, targetBuyPence };
}
