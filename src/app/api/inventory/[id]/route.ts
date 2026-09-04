import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { isManagedInventoryPhotoBlobUrl } from "@/lib/photos/uploadPolicy";
import { del } from "@vercel/blob";
import { lockInventoryItemForSale } from "@/lib/inventory/saleTransaction";
import { inventoryLedgerGuard } from "@/lib/dealer/saleLedger";
import { acquiredAtSchema } from "@/lib/inventory/acquiredAt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const itemPatchSchema = z.object({
  status: z.enum(["IN_STOCK", "LISTED", "SOLD", "RESERVED"]).optional(),
  quantity: z.coerce.number().int().positive().optional(),
  costBasisPence: z.coerce.number().int().nonnegative().optional(),
  acquiredFrom: z.string().trim().min(1).nullable().optional(),
  acquiredAt: acquiredAtSchema.optional(),
  location: z.string().trim().min(1).nullable().optional(),
  condition: z.string().trim().min(1).nullable().optional(),
  graderCert: z.string().trim().min(1).nullable().optional(),
});

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const body = await request.json().catch(() => null);
  const parsed = itemPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid inventory update",
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
      if (!await lockInventoryItemForSale(tx, params.id)) return null;
      const existing = await tx.inventoryItem.findUnique({
        where: { id: params.id }, include: { sales: { select: { costBasis: true } } },
      });
      if (!existing) return null;
      const error = inventoryLedgerGuard({
        saleCount: existing.sales.length,
        legacySaleCount: existing.sales.filter((sale) => sale.costBasis == null).length,
        changingCost: d.costBasisPence !== undefined && d.costBasisPence !== existing.costBasis,
        changingIdentity: (d.condition !== undefined && d.condition !== existing.condition) || (d.graderCert !== undefined && d.graderCert !== existing.graderCert),
        changingSoldStatus: d.status !== undefined && d.status !== existing.status && (d.status === "SOLD" || existing.status === "SOLD"),
        changingSoldQuantity: existing.status === "SOLD" && d.quantity !== undefined && d.quantity !== existing.quantity,
      });
      if (error) return { error };
      const item = await tx.inventoryItem.update({
        where: { id: params.id },
        data: {
          status: d.status,
          quantity: d.quantity,
          costBasis: d.costBasisPence,
          acquiredFrom: d.acquiredFrom,
          acquiredAt: d.acquiredAt,
          location: d.location,
          condition: d.condition,
          graderCert: d.graderCert,
        },
        include: {
          card: true,
          listings: { orderBy: { createdAt: "desc" } },
          sales: { orderBy: { soldAt: "desc" } },
          photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
        },
      });
      return { item };
    });
    if (!result) return NextResponse.json({ error: "Inventory item not found" }, { status: 404 });
    return NextResponse.json(result, { status: "error" in result ? 409 : 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inventory update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  try {
    const prisma = getPrisma();
    const result = await prisma.$transaction(async (tx) => {
      if (!await lockInventoryItemForSale(tx, params.id)) return null;
      const existing = await tx.inventoryItem.findUnique({
        where: { id: params.id },
        include: { _count: { select: { sales: true } }, listings: true, photos: { select: { url: true } } },
      });
      if (!existing) return null;
      const error = inventoryLedgerGuard({
        deleting: true,
        saleCount: existing._count.sales,
        exposedListingCount: existing.listings.filter((listing) => listing.state === "ACTIVE" && listing.channel !== "IN_PERSON").length,
      });
      if (error) return { error };
      await tx.listing.deleteMany({ where: { itemId: params.id } });
      await tx.inventoryItem.delete({ where: { id: params.id } });
      return { managedBlobUrls: [...new Set(existing.photos.map((photo) => photo.url).filter(isManagedInventoryPhotoBlobUrl))] };
    });
    if (!result) return NextResponse.json({ error: "Inventory item not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    // Never remove photos before the history safeguards and stock transaction succeed.
    let photoCleanupPending = false;
    if (result.managedBlobUrls.length > 0) {
      await del(result.managedBlobUrls).catch(() => { photoCleanupPending = true; });
    }
    return NextResponse.json({ ok: true, photoCleanupPending });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inventory delete failed" },
      { status: 500 },
    );
  }
}
