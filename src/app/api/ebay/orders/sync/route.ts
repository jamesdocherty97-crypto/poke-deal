import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { readEbayOrderImportQueue, syncOwnEbaySales } from "@/lib/ebay/orders";
import { ebayApiErrorResponseBody, ebayErrorMessage } from "@/lib/ebay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const imports = await readEbayOrderImportQueue(getPrisma(), { take: 20 });
    const unmatched = imports.filter((row) => row.status === "UNMATCHED");
    return NextResponse.json({ imports, unmatched, unmatchedCount: unmatched.length });
  } catch (err) {
    return NextResponse.json(
      { error: ebayErrorMessage(err, "eBay order import queue lookup failed") },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const result = await syncOwnEbaySales({ db: getPrisma() as any });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      ebayApiErrorResponseBody(err, "eBay sales sync failed"),
      { status: 500 },
    );
  }
}
