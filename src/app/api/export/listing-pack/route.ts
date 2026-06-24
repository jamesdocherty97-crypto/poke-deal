// Listing-pack CSV export: GET /api/export/listing-pack
// Builds an eBay-ready listing pack CSV for every IN_STOCK / LISTED item. Saved
// draft/active listing prices are used exactly; otherwise the pack falls back to
// cost + margin. Works without eBay credentials, and the eBay Sell API draft-push
// can reuse buildListingPack() later.

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
      include: {
        card: true,
        listings: {
          where: { state: { in: ["DRAFT", "ACTIVE"] } },
          orderBy: { updatedAt: "desc" },
        },
      },
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
        listPricePence: preferredListingPricePence(item.listings),
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

function preferredListingPricePence(listings: unknown): number | undefined {
  if (!Array.isArray(listings)) return undefined;

  return listings
    .map((listing) => {
      const row = listing as Record<string, unknown>;
      return {
        price: numberOrUndefined(row.listPrice) ?? numberOrUndefined(row.suggestedPrice),
        stateRank: row.state === "ACTIVE" ? 0 : row.state === "DRAFT" ? 1 : 2,
        updatedAt: Date.parse(String(row.updatedAt ?? row.createdAt ?? "")) || 0,
      };
    })
    .filter((listing): listing is { price: number; stateRank: number; updatedAt: number } => listing.price != null)
    .sort((a, b) => a.stateRank - b.stateRank || b.updatedAt - a.updatedAt)[0]?.price;
}
