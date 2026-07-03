import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const photoRoleSchema = z.enum(["FRONT", "BACK", "SLAB", "EXTRA"]);

const photoCreateSchema = z.object({
  url: z.string().trim().url().refine((url) => url.startsWith("https://"), "Photo URL must be HTTPS."),
  role: photoRoleSchema.default("FRONT"),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
  order: z.coerce.number().int().nonnegative().default(0),
});

const photoOrderSchema = z.object({
  orderedIds: z.array(z.string().trim().min(1)).min(1),
});

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const item = await getPrisma().inventoryItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
    },
  });

  if (!item) {
    return NextResponse.json({ error: "Inventory item not found." }, { status: 404 });
  }

  return NextResponse.json({ photos: item.photos });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const body = await request.json().catch(() => null);
  const parsed = photoCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid photo",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const item = await getPrisma().inventoryItem.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!item) {
      return NextResponse.json({ error: "Inventory item not found." }, { status: 404 });
    }

    const photo = await getPrisma().cardPhoto.create({
      data: {
        inventoryItemId: params.id,
        url: parsed.data.url,
        role: parsed.data.role,
        width: parsed.data.width,
        height: parsed.data.height,
        order: parsed.data.order,
      },
    });

    return NextResponse.json({ photo }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Photo save failed." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const body = await request.json().catch(() => null);
  const parsed = photoOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid photo order",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const orderedIds = Array.from(new Set(parsed.data.orderedIds));
  if (orderedIds.length !== parsed.data.orderedIds.length) {
    return NextResponse.json({ error: "Photo order includes duplicates." }, { status: 400 });
  }

  try {
    const photos = await getPrisma().cardPhoto.findMany({
      where: { inventoryItemId: params.id },
      select: { id: true },
    });
    const knownIds = new Set(photos.map((photo) => photo.id));
    const unknownId = orderedIds.find((id) => !knownIds.has(id));
    if (unknownId) {
      return NextResponse.json({ error: "Photo does not belong to this inventory item." }, { status: 400 });
    }

    const finalOrder = [
      ...orderedIds,
      ...photos.map((photo) => photo.id).filter((id) => !orderedIds.includes(id)),
    ];
    await getPrisma().$transaction(
      finalOrder.map((id, order) =>
        getPrisma().cardPhoto.update({
          where: { id },
          data: { order },
        }),
      ),
    );

    const updated = await getPrisma().cardPhoto.findMany({
      where: { inventoryItemId: params.id },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ photos: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Photo reorder failed." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const photoId = new URL(request.url).searchParams.get("photoId")?.trim();
  if (!photoId) {
    return NextResponse.json({ error: "photoId is required." }, { status: 400 });
  }

  try {
    const photo = await getPrisma().cardPhoto.findUnique({
      where: { id: photoId },
      select: { id: true, inventoryItemId: true },
    });
    if (!photo || photo.inventoryItemId !== params.id) {
      return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    }

    await getPrisma().cardPhoto.delete({ where: { id: photoId } });
    const remaining = await getPrisma().cardPhoto.findMany({
      where: { inventoryItemId: params.id },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (remaining.length > 0) {
      await getPrisma().$transaction(
        remaining.map((row, order) =>
          getPrisma().cardPhoto.update({
            where: { id: row.id },
            data: { order },
          }),
        ),
      );
    }

    const photos = await getPrisma().cardPhoto.findMany({
      where: { inventoryItemId: params.id },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ photos });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Photo delete failed." },
      { status: 500 },
    );
  }
}
