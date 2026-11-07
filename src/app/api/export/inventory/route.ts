import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { inventoryItemsToCsv, inventoryV1Filename, type InventoryExportItem } from "@/lib/exports/inventoryV1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getPrisma().inventoryItem.findMany({
      include: {
        card: true,
        listings: { select: { id: true, createdAt: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return csvResponse(inventoryItemsToCsv(items.map(toExportItem)), inventoryV1Filename());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inventory export failed" },
      { status: 500 },
    );
  }
}

function toExportItem(item: {
  id: string;
  cardId: string;
  grade: string;
  graderCert: string | null;
  condition: string | null;
  quantity: number;
  costBasis: number;
  acquiredFrom: string | null;
  acquiredAt: Date | null;
  location: string | null;
  status: string;
  card: {
    id: string;
    name: string;
    setName: string;
    number: string | null;
    language: string | null;
    edition: string | null;
    finish: string | null;
  };
  listings: { id: string; createdAt: Date }[];
}): InventoryExportItem {
  return {
    id: item.id,
    cardId: item.cardId,
    grade: item.grade,
    graderCert: item.graderCert,
    condition: item.condition,
    quantity: item.quantity,
    costBasis: item.costBasis,
    acquiredFrom: item.acquiredFrom,
    acquiredAt: item.acquiredAt,
    location: item.location,
    status: item.status,
    card: {
      id: item.card.id,
      name: item.card.name,
      setName: item.card.setName,
      number: item.card.number,
      language: item.card.language,
      edition: item.card.edition,
      finish: item.card.finish,
    },
    listings: item.listings.map((listing) => ({ id: listing.id, createdAt: listing.createdAt })),
  };
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
