import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { planSaleUndo } from "@/lib/dealer/unitSale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const result = await getPrisma().$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: params.id },
        include: { item: true },
      });

      if (!sale) return null;

      const undo = planSaleUndo({
        quantity: sale.item.quantity,
        status: sale.item.status,
      });

      await tx.sale.delete({ where: { id: sale.id } });
      const item = await tx.inventoryItem.update({
        where: { id: sale.itemId },
        data: {
          quantity: undo.quantity,
          status: undo.status,
        },
        include: {
          card: true,
          listings: { orderBy: { createdAt: "desc" } },
          sales: { orderBy: { soldAt: "desc" } },
        },
      });

      return { item, restoredQuantity: undo.restoredQuantity };
    });

    if (!result) {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sale undo failed" },
      { status: 500 },
    );
  }
}
