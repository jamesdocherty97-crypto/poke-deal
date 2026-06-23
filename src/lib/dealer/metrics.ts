import { realizedProfit } from "../comps/pricing.js";

export type DealerStatus = "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";

export interface DealerInventoryMetricItem {
  id: string;
  name: string;
  grade: string;
  status: DealerStatus;
  quantity: number;
  costBasisPence: number;
  createdAt: string;
}

export interface DealerSaleMetricItem {
  id: string;
  itemId: string;
  name: string;
  grade: string;
  channel: string;
  salePricePence: number;
  feesPence: number;
  postagePence: number;
  costBasisPence: number;
  soldAt: string;
}

export interface DealerExpenseMetricItem {
  id: string;
  category: string;
  description: string;
  amountPence: number;
  spentAt: string;
}

export interface DealerMetrics {
  stockCount: number;
  listedCount: number;
  soldCount: number;
  reservedCount: number;
  activeCostPence: number;
  soldCostPence: number;
  realizedRevenuePence: number;
  realizedFeesPence: number;
  realizedPostagePence: number;
  realizedProfitPence: number;
  operatingExpensePence: number;
  netProfitPence: number;
  cashInPence: number;
  cashOutPence: number;
  cashNetPence: number;
  cashRecoveryPct: number;
  realizedMarginPct: number | null;
  sellThroughPct: number;
  averageAgeDays: number;
  agedStockCount: number;
  channelBreakdown: DealerChannelSummary[];
  bestSale: DealerSaleSummary | null;
  worstSale: DealerSaleSummary | null;
}

export interface DealerChannelSummary {
  channel: string;
  saleCount: number;
  revenuePence: number;
  feesPence: number;
  postagePence: number;
  costPence: number;
  profitPence: number;
  averageSalePence: number;
  averageProfitPence: number;
  marginPct: number | null;
}

export interface DealerSaleSummary {
  id: string;
  itemId: string;
  name: string;
  grade: string;
  channel: string;
  salePricePence: number;
  feesPence: number;
  postagePence: number;
  costBasisPence: number;
  profitPence: number;
  marginPct: number | null;
  soldAt: string;
}

export interface ProfitTrendPoint {
  date: string;
  profitPence: number;
  cumulativeProfitPence: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const AGED_STOCK_DAYS = 45;

export function computeDealerMetrics(
  items: DealerInventoryMetricItem[],
  sales: DealerSaleMetricItem[],
  now: Date = new Date(),
  expenses: DealerExpenseMetricItem[] = [],
): DealerMetrics {
  const activeItems = items.filter((item) => item.status !== "SOLD");
  const activeUnits = activeItems.reduce((sum, item) => sum + item.quantity, 0);
  const stockCount = countByStatus(items, "IN_STOCK");
  const listedCount = countByStatus(items, "LISTED");
  const soldCount = sales.length;
  const reservedCount = countByStatus(items, "RESERVED");
  const activeCostPence = activeItems.reduce(
    (sum, item) => sum + item.costBasisPence * item.quantity,
    0,
  );

  const realizedRevenuePence = sales.reduce((sum, sale) => sum + sale.salePricePence, 0);
  const soldCostPence = sales.reduce((sum, sale) => sum + sale.costBasisPence, 0);
  const realizedFeesPence = sales.reduce((sum, sale) => sum + sale.feesPence, 0);
  const realizedPostagePence = sales.reduce((sum, sale) => sum + sale.postagePence, 0);
  const saleSummaries = sales.map(summarizeSale);
  const realizedProfitPence = saleSummaries.reduce((sum, sale) => sum + sale.profitPence, 0);
  const operatingExpensePence = expenses.reduce((sum, expense) => sum + expense.amountPence, 0);
  const netProfitPence = realizedProfitPence - operatingExpensePence;
  const cashInPence = realizedRevenuePence;
  const cashOutPence = activeCostPence + soldCostPence + realizedFeesPence + realizedPostagePence + operatingExpensePence;
  const cashNetPence = cashInPence - cashOutPence;
  const cashRecoveryPct = cashOutPence > 0 ? roundPct(cashInPence / cashOutPence) : 0;
  const realizedMarginPct =
    realizedRevenuePence > 0 ? roundPct(realizedProfitPence / realizedRevenuePence) : null;
  const unitDenominator = activeUnits + soldCount;
  const sellThroughPct = unitDenominator > 0 ? roundPct(soldCount / unitDenominator) : 0;

  const ages = activeItems.map((item) => ageDays(item.createdAt, now));
  const averageAgeDays =
    ages.length > 0 ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length) : 0;
  const agedStockCount = ages.filter((age) => age >= AGED_STOCK_DAYS).length;

  const sortedSales = [...saleSummaries].sort((a, b) => b.profitPence - a.profitPence);
  const channelBreakdown = buildChannelBreakdown(saleSummaries);

  return {
    stockCount,
    listedCount,
    soldCount,
    reservedCount,
    activeCostPence,
    soldCostPence,
    realizedRevenuePence,
    realizedFeesPence,
    realizedPostagePence,
    realizedProfitPence,
    operatingExpensePence,
    netProfitPence,
    cashInPence,
    cashOutPence,
    cashNetPence,
    cashRecoveryPct,
    realizedMarginPct,
    sellThroughPct,
    averageAgeDays,
    agedStockCount,
    channelBreakdown,
    bestSale: sortedSales[0] ?? null,
    worstSale: sortedSales.at(-1) ?? null,
  };
}

export function summarizeSale(sale: DealerSaleMetricItem): DealerSaleSummary {
  const profitPence = realizedProfit({
    salePrice: sale.salePricePence,
    fees: sale.feesPence,
    postage: sale.postagePence,
    costBasis: sale.costBasisPence,
  });

  return {
    id: sale.id,
    itemId: sale.itemId,
    name: sale.name,
    grade: sale.grade,
    channel: sale.channel,
    salePricePence: sale.salePricePence,
    feesPence: sale.feesPence,
    postagePence: sale.postagePence,
    costBasisPence: sale.costBasisPence,
    profitPence,
    marginPct: sale.salePricePence > 0 ? roundPct(profitPence / sale.salePricePence) : null,
    soldAt: sale.soldAt,
  };
}

export function buildChannelBreakdown(sales: DealerSaleSummary[]): DealerChannelSummary[] {
  const byChannel = new Map<string, DealerChannelSummary>();

  for (const sale of sales) {
    const current =
      byChannel.get(sale.channel) ??
      {
        channel: sale.channel,
        saleCount: 0,
        revenuePence: 0,
        feesPence: 0,
        postagePence: 0,
        costPence: 0,
        profitPence: 0,
        averageSalePence: 0,
        averageProfitPence: 0,
        marginPct: null,
      };

    current.saleCount += 1;
    current.revenuePence += sale.salePricePence;
    current.feesPence += sale.feesPence;
    current.postagePence += sale.postagePence;
    current.costPence += sale.costBasisPence;
    current.profitPence += sale.profitPence;
    byChannel.set(sale.channel, current);
  }

  return [...byChannel.values()]
    .map((row) => ({
      ...row,
      averageSalePence: row.saleCount > 0 ? Math.round(row.revenuePence / row.saleCount) : 0,
      averageProfitPence: row.saleCount > 0 ? Math.round(row.profitPence / row.saleCount) : 0,
      marginPct: row.revenuePence > 0 ? roundPct(row.profitPence / row.revenuePence) : null,
    }))
    .sort((a, b) => b.profitPence - a.profitPence || b.revenuePence - a.revenuePence || a.channel.localeCompare(b.channel));
}

export function buildProfitTrend(
  sales: Array<Pick<DealerSaleSummary, "profitPence" | "soldAt">>,
  maxPoints = 8,
): ProfitTrendPoint[] {
  const dailyProfit = new Map<string, number>();
  for (const sale of sales) {
    const date = dateKey(sale.soldAt);
    if (!date) continue;
    dailyProfit.set(date, (dailyProfit.get(date) ?? 0) + sale.profitPence);
  }

  let cumulativeProfitPence = 0;
  const points = [...dailyProfit.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, profitPence]) => {
      cumulativeProfitPence += profitPence;
      return { date, profitPence, cumulativeProfitPence };
    });

  return points.slice(-Math.max(1, maxPoints));
}

function countByStatus(items: DealerInventoryMetricItem[], status: DealerStatus): number {
  return items
    .filter((item) => item.status === status)
    .reduce((sum, item) => sum + item.quantity, 0);
}

function ageDays(createdAt: string, now: Date): number {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((now.getTime() - created) / DAY_MS));
}

function roundPct(value: number): number {
  return Math.round(value * 1000) / 10;
}

function dateKey(value: string): string | null {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}
