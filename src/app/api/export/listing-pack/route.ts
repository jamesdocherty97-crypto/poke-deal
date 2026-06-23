// Listing-pack CSV export: GET /api/export/listing-pack
// Builds an eBay-ready listing pack CSV for every IN_STOCK / LISTED item, using
// each item's last persisted comp median as the price anchor. Copy-ready titles,
// item specifics, suggested price and UK postage. Works without eBay credentials;
// the eBay Sell API draft-push (Priority 4) can reuse buildListingPack() later.

import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { buildListingPackCsv, type ListingPackInput } from "@/lib/dealer/listingPack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  try {
    const prisma = getPrisma() as unknown as {
      inventoryItem: {
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
      };
    };

    const items = await prisma.inventoryItem.findMany({
      where: { status: { in: ["IN_STOCK", "LISTED"] } },
      include: { card: true },
      orderBy: { createdAt: "desc" },
    });

    const inputs: ListingPackInput[] = items.map((item) => {
      const card = (item.card ?? {}) as Record<string, unknown>;
      return {
        card: {
          name: String(card.name ?? "Unknown card"),
          setName: (card.setName as string | null) ?? null,
          number: (card.number as string | null) ?? null,
          rarity: (card.rarity as string | null) ?? null,
          language: (card.language as string | null) ?? "EN",
        },
        grade: String(item.grade ?? "RAW"),
        // No comp median is persisted on the item, so price anchors on cost + margin.
        // The eBay Sell API step can pass a live comp median into buildListingPack().
        costBasisPence: numberOrUndefined(item.costBasis),
        condition: (item.condition as string | null) ?? null,
        certNumber: (item.graderCert as string | null) ?? null,
      };
    });

    const csv = buildListingPackCsv(inputs);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="listing-pack-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "export failed" },
      { status: 500 },
    );
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
