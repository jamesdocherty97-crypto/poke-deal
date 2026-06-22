import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { booksToCsv, type BookSaleExportRecord } from "@/lib/exports/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sales = await getPrisma().sale.findMany({
      include: {
        item: {
          include: {
            card: true,
          },
        },
      },
      orderBy: { soldAt: "desc" },
    });

    return csvResponse(
      booksToCsv(sales as BookSaleExportRecord[]),
      `pokemon-dealer-books-${dateStamp()}.csv`,
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "books export failed" },
      { status: 500 },
    );
  }
}

function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
