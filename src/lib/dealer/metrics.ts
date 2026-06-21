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

export interface DealerMetrics {
  stockCount: number;
  listedCount: number;
  soldCount: number;
  reservedCount: number;
  activeCostPence: number;
  realizedRevenuePence: number;
  realizedProfitPence: number;
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

const DAY_MS = 24 * 60 * 60 * 1000;
const AGED_STOCK_DAYS = 45;

export function computeDealerMetrics(
  items: DealerInventoryMetricItem[],
  sales: DealerSaleMetricItem[],
  now: Date = new Date(),
): DealerMetrics {
  const activeItems = items.filter((item) => item.status !== "SOLD");
  const stockCount = countByStatus(items, "IN_STOCK");
  const listedCount = countByStatus(items, "LISTED");
  const soldCount = countByStatus(items, "SOLD");
  const reservedCount = countByStatus(items, "RESERVED");
  const activeCostPence = activeItems.reduce(
    (sum, item) => sum + item.costBasisPence * item.quantity,
    0,
  );

  const realizedRevenuePence = sales.reduce((sum, sale) => sum + sale.salePricePence, 0);
  const saleSummaries = sales.map(summarizeSale);
  const realizedProfitPence = saleSummaries.reduce((sum, sale) => sum + sale.profitPence, 0);
  const realizedMarginPct =
    realizedRevenuePence > 0 ? roundPct(realizedProfitPence / realizedRevenuePence) : null;
  const sellThroughPct = items.length > 0 ? roundPct(soldCount / items.length) : 0;

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
