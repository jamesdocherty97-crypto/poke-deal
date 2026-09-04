import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { planSaleUndo } from "@/lib/dealer/unitSale";
import { lockInventoryItemForSale } from "@/lib/inventory/saleTransaction";
import { canUndoSale, planSaleAmountRevision, saleAmountsPatchSchema } from "@/lib/dealer/saleLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const parsed = saleAmountsPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter nonnegative amounts and a correction reason.", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const result = await getPrisma().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${id} FOR UPDATE`;
      const sale = await tx.sale.findUnique({ where: { id } });
      if (!sale) return null;
      if (parsed.data.itemRevenuePence != null && parsed.data.itemRevenuePence > sale.salePrice) {
        return { error: "Item revenue cannot exceed the recorded buyer payment." };
      }
      const revision = planSaleAmountRevision(sale, parsed.data);
      const updated = revision ? await tx.sale.update({ where: { id }, data: revision }) : sale;
      return { sale: updated, idempotent: revision == null };
    });
    if (!result) return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sale cost confirmation failed" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  try {
    const result = await getPrisma().$transaction(async (tx) => {
      const initial = await tx.sale.findUnique({ where: { id: params.id }, select: { itemId: true } });
      if (!initial) return null;
      await lockInventoryItemForSale(tx, initial.itemId);
      await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${params.id} FOR UPDATE`;
      const sale = await tx.sale.findUnique({
        where: { id: params.id },
        include: { item: true, ebayOrderImport: true },
      });

      if (!sale) return null;
      if (!canUndoSale(sale)) {
        return { error: "Historical, imported or reconciled sales cannot be undone. Confirm costs in Profit; handle returns/refunds in the marketplace and retain this record." };
      }

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
    if ("error" in result) return NextResponse.json(result, { status: 409 });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sale undo failed" },
      { status: 500 },
    );
  }
}
