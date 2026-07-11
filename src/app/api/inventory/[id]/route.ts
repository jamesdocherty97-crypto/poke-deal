import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const itemPatchSchema = z.object({
  status: z.enum(["IN_STOCK", "LISTED", "SOLD", "RESERVED"]).optional(),
  quantity: z.coerce.number().int().positive().optional(),
  costBasisPence: z.coerce.number().int().nonnegative().optional(),
  acquiredFrom: z.string().trim().min(1).nullable().optional(),
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
    const item = await getPrisma().inventoryItem.update({
      where: { id: params.id },
      data: {
        status: d.status,
        quantity: d.quantity,
        costBasis: d.costBasisPence,
        acquiredFrom: d.acquiredFrom,
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
    return NextResponse.json({ item });
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
    await getPrisma().$transaction(async (tx) => {
      await tx.sale.deleteMany({ where: { itemId: params.id } });
      await tx.listing.deleteMany({ where: { itemId: params.id } });
      await tx.inventoryItem.delete({ where: { id: params.id } });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inventory delete failed" },
      { status: 500 },
    );
  }
}
