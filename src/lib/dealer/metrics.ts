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
  realizedRevenuePence: number;
  realizedProfitPence: number;
  operatingExpensePence: number;
  netProfitPence: number;
  realizedMarginPct: number | null;
  sellThroughPct: number;
  averageAgeDays: number;
  agedStockCount: number;
  bestSale: DealerSaleSummary | null;
  worstSale: DealerSaleSummary | null;
}

export interface DealerSaleSummary {
  id: string;
  itemId: string;
  name: string;
  grade: string;
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
  const saleSummaries = sales.map(summarizeSale);
  const realizedProfitPence = saleSummaries.reduce((sum, sale) => sum + sale.profitPence, 0);
  const operatingExpensePence = expenses.reduce((sum, expense) => sum + expense.amountPence, 0);
  const netProfitPence = realizedProfitPence - operatingExpensePence;
  const realizedMarginPct =
    realizedRevenuePence > 0 ? roundPct(realizedProfitPence / realizedRevenuePence) : null;
  const unitDenominator = activeUnits + soldCount;
  const sellThroughPct = unitDenominator > 0 ? roundPct(soldCount / unitDenominator) : 0;

  const ages = activeItems.map((item) => ageDays(item.createdAt, now));
  const averageAgeDays =
    ages.length > 0 ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length) : 0;
  const agedStockCount = ages.filter((age) => age >= AGED_STOCK_DAYS).length;

  const sortedSales = [...saleSummaries].sort((a, b) => b.profitPence - a.profitPence);

  return {
    stockCount,
    listedCount,
    soldCount,
    reservedCount,
    activeCostPence,
    realizedRevenuePence,
    realizedProfitPence,
    operatingExpensePence,
    netProfitPence,
    realizedMarginPct,
    sellThroughPct,
    averageAgeDays,
    agedStockCount,
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
    profitPence,
    marginPct: sale.salePricePence > 0 ? roundPct(profitPence / sale.salePricePence) : null,
    soldAt: sale.soldAt,
  };
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
