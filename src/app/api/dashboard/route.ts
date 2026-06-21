import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { computeDealerMetrics, summarizeSale } from "@/lib/dealer/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getPrisma().inventoryItem.findMany({
      include: {
        card: true,
        listings: true,
        sales: { orderBy: { soldAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });

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

    const listingsByState = items
      .flatMap((item) => item.listings)
      .reduce<Record<string, number>>((counts, listing) => {
        counts[listing.state] = (counts[listing.state] ?? 0) + 1;
        return counts;
      }, {});

    return NextResponse.json({
      metrics: computeDealerMetrics(metricItems, metricSales),
      recentSales: metricSales
        .map(summarizeSale)
        .sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt))
        .slice(0, 8),
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
