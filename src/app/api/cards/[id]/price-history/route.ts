import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { GRADE_VALUES, type Grade } from "@/lib/domain/types";
import { readCardPriceHistory, type PriceHistoryDb } from "@/lib/comps/priceHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const query = new URL(request.url).searchParams;
  const rawGrade = query.get("grade")?.trim().toUpperCase() ?? "RAW";
  if (!GRADE_VALUES.includes(rawGrade as Grade)) {
    return NextResponse.json({ error: `Unsupported grade: ${rawGrade}` }, { status: 400 });
  }
  const rawDays = Number(query.get("days") ?? 365);
  const history = await readCardPriceHistory(getPrisma() as unknown as PriceHistoryDb, {
    cardId: params.id,
    grade: rawGrade as Grade,
    days: Number.isFinite(rawDays) ? rawDays : 365,
  });
  if (!history) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  return NextResponse.json(history);
}
