import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { computeDealerMetrics, summarizeSale, type DealerStatus } from "@/lib/dealer/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Explicit shape for the findMany() below so this route type-checks even if
// the generated Prisma client is ever incomplete/stale in a given environment
// (e.g. a sandbox without network access to fetch engine binaries) -- only
// the fields this route actually reads, kept in sync with the include/orderBy
// below and with DealerInventoryMetricItem in lib/dealer/metrics.ts.
type DashboardInventoryItem = {
  id: string;
  card: { name: string };
  grade: string;
  status: DealerStatus;
  quantity: number;
  costBasis: number;
  createdAt: Date;
  listings: { state: string }[];
  sales: { id: string; salePrice: number; fees: number; postage: number; soldAt: Date }[];
};

type DashboardExpense = {
  id: string;
  category: string;
  description: string;
  amount: number;
  spentAt: Date;
  channel: string | null;
  source: string | null;
};

export async function GET() {
  try {
    const prisma = getPrisma();
    const [items, expenses]: [DashboardInventoryItem[], DashboardExpense[]] = await Promise.all([
      prisma.inventoryItem.findMany({
        include: {
          card: true,
          listings: true,
          sales: { orderBy: { soldAt: "desc" } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.expense.findMany({
        orderBy: { spentAt: "desc" },
      }),
    ]);

    const metricItems = items.map((item) => ({
      id: item.id,
      name: item.card.name,
      grade: item.grade,
      status: item.status,
      quantity: item.quantity,
      costBasisPence: item.costBasis,
      createdAt: item.createdAt.toISOString(),
    }));
    const metricSales = items.flatMap((item) =>
      item.sales.map((sale) => ({
        id: sale.id,
        itemId: item.id,
        name: item.card.name,
        grade: item.grade,
        salePricePence: sale.salePrice,
        feesPence: sale.fees,
        postagePence: sale.postage,
        costBasisPence: item.costBasis,
        soldAt: sale.soldAt.toISOString(),
      })),
    );
    const metricExpenses = expenses.map((expense) => ({
      id: expense.id,
      category: expense.category,
      description: expense.description,
      amountPence: expense.amount,
      spentAt: expense.spentAt.toISOString(),
    }));

    const listingsByState = items
      .flatMap((item) => item.listings)
      .reduce<Record<string, number>>((counts, listing) => {
        counts[listing.state] = (counts[listing.state] ?? 0) + 1;
        return counts;
      }, {});

    return NextResponse.json({
      metrics: computeDealerMetrics(metricItems, metricSales, new Date(), metricExpenses),
      recentSales: metricSales
        .map(summarizeSale)
        .sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt))
        .slice(0, 8),
      recentExpenses: expenses.slice(0, 8).map((expense) => ({
        ...expense,
        spentAt: expense.spentAt.toISOString(),
      })),
      staleStock: metricItems
        .filter((item) => item.status !== "SOLD")
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .slice(0, 8),
      listingsByState,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "dashboard lookup failed" },
      { status: 500 },
    );
  }
}
