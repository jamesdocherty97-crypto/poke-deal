import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { realizedProfit } from "@/lib/comps/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sellSchema = z.object({
  channel: z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]).default("EBAY"),
  salePricePence: z.coerce.number().int().nonnegative(),
  feesPence: z.coerce.number().int().nonnegative().default(0),
  postagePence: z.coerce.number().int().nonnegative().default(0),
  soldAt: z.coerce.date().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const body = await request.json().catch(() => null);
  const parsed = sellSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid sale request",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const d = parsed.data;
    const result = await getPrisma().$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({
        where: { id: params.id },
        include: { card: true },
      });
      if (!item) throw new Error("Inventory item not found");

      const sale = await tx.sale.create({
        data: {
          itemId: item.id,
          channel: d.channel,
          salePrice: d.salePricePence,
          fees: d.feesPence,
          postage: d.postagePence,
          soldAt: d.soldAt ?? new Date(),
        },
      });

      const updatedItem = await tx.inventoryItem.update({
        where: { id: item.id },
        data: { status: "SOLD" },
        include: {
          card: true,
          listings: { orderBy: { createdAt: "desc" } },
          sales: { orderBy: { soldAt: "desc" } },
        },
      });

      await tx.listing.updateMany({
        where: { itemId: item.id, state: { in: ["DRAFT", "ACTIVE"] } },
        data: { state: "SOLD", endedAt: sale.soldAt },
      });

      return { item: updatedItem, sale };
    });

    const profitPence = realizedProfit({
      salePrice: result.sale.salePrice,
      fees: result.sale.fees,
      postage: result.sale.postage,
      costBasis: result.item.costBasis,
    });

    return NextResponse.json({ ...result, profitPence }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "mark sold failed" },
      { status: 500 },
    );
  }
}
