import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const listings = await getPrisma().listing.findMany({
      include: {
        item: {
          include: {
            card: true,
            sales: { orderBy: { soldAt: "desc" } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ listings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "listing lookup failed" },
      { status: 500 },
    );
  }
}
