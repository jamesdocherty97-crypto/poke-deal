export type DealSessionLineStatus = "auto" | "excluded" | "override";

export interface DealSessionLineInput {
  id: string;
  headlinePence: number;
  manualCheck: boolean;
  maxCashOfferPence?: number | null;
  maxTradeOfferPence?: number | null;
  dealerOfferPence?: number | null;
  netProceedsPence?: number | null;
  expectedProfitPence?: number | null;
}

export interface DealSessionLineSummary extends DealSessionLineInput {
  status: DealSessionLineStatus;
  cashBasisPence: number;
  tradeBasisPence: number;
  includedInAutoTotals: boolean;
  requiresOverrideForCompletion: boolean;
}

export interface DealSessionSummary {
  lines: DealSessionLineSummary[];
  includedCount: number;
  excludedCount: number;
  totalMaxCashPence: number;
  totalMaxTradePence: number;
  totalExpectedProceedsPence: number;
  totalExpectedProfitPence: number;
  suggestedBundleOfferPence: number;
  completionReady: boolean;
  completionBlockers: string[];
}

export interface DealSessionAllocation {
  lineId: string;
  basisPence: number;
  costBasisPence: number;
}

export function summarizeDealSession(lines: DealSessionLineInput[]): DealSessionSummary {
  const summaries = lines.map(summarizeLine);
  const included = summaries.filter((line) => line.includedInAutoTotals);
  const excludedCount = summaries.length - included.length;
  const totalMaxCashPence = sum(included.map((line) => line.cashBasisPence));
  const totalMaxTradePence = sum(included.map((line) => line.tradeBasisPence));
  const totalExpectedProceedsPence = sum(included.map((line) => line.netProceedsPence ?? 0));
  const totalExpectedProfitPence = sum(included.map((line) => line.expectedProfitPence ?? 0));
  const completionBlockers = buildCompletionBlockers(summaries);

  return {
    lines: summaries,
    includedCount: included.length,
    excludedCount,
    totalMaxCashPence,
    totalMaxTradePence,
    totalExpectedProceedsPence,
    totalExpectedProfitPence,
    suggestedBundleOfferPence: roundBundleOfferDown(totalMaxCashPence),
    completionReady: summaries.length > 0 && completionBlockers.length === 0,
    completionBlockers,
  };
}

export function allocateDealSessionCost(lines: DealSessionLineInput[], paidPence: number): DealSessionAllocation[] {
  if (!Number.isInteger(paidPence) || paidPence < 0) {
    throw new Error("paidPence must be a non-negative integer");
  }
  const summaries = lines.map(summarizeLine);
  const blockers = buildCompletionBlockers(summaries);
  if (blockers.length > 0) {
    throw new Error(blockers.join("; "));
  }

  const basisLines = summaries.map((line) => ({ lineId: line.id, basisPence: line.cashBasisPence }));
  const totalBasisPence = sum(basisLines.map((line) => line.basisPence));
  if (totalBasisPence <= 0) {
    throw new Error("completion requires at least one priced line");
  }

  const allocations = basisLines.map((line) => {
    const exact = (paidPence * line.basisPence) / totalBasisPence;
    const floor = Math.floor(exact);
    return {
      ...line,
      costBasisPence: floor,
      remainder: exact - floor,
    };
  });

  let remainingPence = paidPence - sum(allocations.map((line) => line.costBasisPence));
  allocations
    .sort((left, right) => right.remainder - left.remainder || right.basisPence - left.basisPence || left.lineId.localeCompare(right.lineId))
    .forEach((line) => {
      if (remainingPence <= 0) return;
      line.costBasisPence += 1;
      remainingPence -= 1;
    });

  return allocations
    .sort((left, right) => lines.findIndex((line) => line.id === left.lineId) - lines.findIndex((line) => line.id === right.lineId))
    .map(({ lineId, basisPence, costBasisPence }) => ({ lineId, basisPence, costBasisPence }));
}

export function roundBundleOfferDown(totalCashPence: number): number {
  const step = totalCashPence < 10000 ? 500 : 1000;
  return Math.floor(Math.max(0, totalCashPence) / step) * step;
}

function summarizeLine(line: DealSessionLineInput): DealSessionLineSummary {
  const override = positivePence(line.dealerOfferPence);
  const autoCash = positivePence(line.maxCashOfferPence);
  const autoTrade = positivePence(line.maxTradeOfferPence);
  const hasOverride = override > 0;
  const excluded = line.manualCheck || autoCash <= 0;
  const cashBasisPence = hasOverride ? override : excluded ? 0 : autoCash;
  const tradeBasisPence = hasOverride ? override : excluded ? 0 : autoTrade;

  return {
    ...line,
    status: excluded ? (hasOverride ? "override" : "excluded") : "auto",
    cashBasisPence,
    tradeBasisPence,
    includedInAutoTotals: !excluded || hasOverride,
    requiresOverrideForCompletion: excluded && !hasOverride,
  };
}

function buildCompletionBlockers(lines: DealSessionLineSummary[]): string[] {
  const blockers: string[] = [];
  const missingOverrideCount = lines.filter((line) => line.requiresOverrideForCompletion).length;
  if (missingOverrideCount > 0) blockers.push(`${missingOverrideCount} manual/no-quote line${missingOverrideCount === 1 ? "" : "s"} need an override`);
  if (lines.length === 0) blockers.push("session has no lines");
  if (!lines.some((line) => line.cashBasisPence > 0)) blockers.push("session has no priced lines");
  return blockers;
}

function positivePence(value: number | null | undefined): number {
  return Number.isInteger(value) && value != null && value > 0 ? value : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
