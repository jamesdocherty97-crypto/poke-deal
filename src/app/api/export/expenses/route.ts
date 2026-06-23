import { NextResponse } from "next/server";
import { expensesToCsv, type ExpenseExportRecord } from "@/lib/exports/csv";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const expenses = await getPrisma().expense.findMany({
      orderBy: { spentAt: "desc" },
    });
    return csvResponse(
      expensesToCsv(expenses as ExpenseExportRecord[]),
      `pokemon-dealer-expenses-${dateStamp()}.csv`,
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "expenses export failed" },
      { status: 500 },
    );
  }
}

function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
