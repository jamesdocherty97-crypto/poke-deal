import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { orderListingPhotos } from "@/lib/photos/listingPhotoPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const photoRoleSchema = z.enum(["FRONT", "BACK", "SLAB", "EXTRA"]);
const photoOriginSchema = z.enum(["REAL", "CATALOG"]);

const photoCreateSchema = z.object({
  url: z.string().trim().url().refine((url) => url.startsWith("https://"), "Photo URL must be HTTPS."),
  role: photoRoleSchema.default("FRONT"),
  origin: photoOriginSchema.default("REAL"),
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
  const prisma = getPrisma();
  const item = await prisma.inventoryItem.findUnique({
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
    const prisma = getPrisma();
    const item = await prisma.inventoryItem.findUnique({
      where: { id: params.id },
      select: { id: true, card: { select: { imageUrl: true } } },
    });
    if (!item) {
      return NextResponse.json({ error: "Inventory item not found." }, { status: 404 });
    }

    if (parsed.data.origin === "CATALOG") {
      const catalogUrl = item.card.imageUrl?.trim();
      if (!catalogUrl) {
        return NextResponse.json({ error: "This card has no catalog art saved yet." }, { status: 400 });
      }
      if (parsed.data.url !== catalogUrl) {
        return NextResponse.json({ error: "Catalog photos must use the saved card catalog image." }, { status: 400 });
      }
    }

    const photo = await prisma.cardPhoto.create({
      data: {
        inventoryItemId: params.id,
        url: parsed.data.url,
        role: parsed.data.role,
        origin: parsed.data.origin,
        width: parsed.data.width,
        height: parsed.data.height,
        order: parsed.data.order,
      },
    });
    const photos = await normalizePhotoOrder(params.id);

    return NextResponse.json({ photo, photos }, { status: 201 });
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
    const prisma = getPrisma();
    const photos = await prisma.cardPhoto.findMany({
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
    await prisma.$transaction(
      finalOrder.map((id, order) =>
        prisma.cardPhoto.update({
          where: { id },
          data: { order },
        }),
      ),
    );

    const updated = await normalizePhotoOrder(params.id);

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
    const prisma = getPrisma();
    const photo = await prisma.cardPhoto.findUnique({
      where: { id: photoId },
      select: { id: true, inventoryItemId: true },
    });
    if (!photo || photo.inventoryItemId !== params.id) {
      return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    }

    await prisma.cardPhoto.delete({ where: { id: photoId } });
    const photos = await normalizePhotoOrder(params.id);

    return NextResponse.json({ photos });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Photo delete failed." },
      { status: 500 },
    );
  }
}

async function normalizePhotoOrder(inventoryItemId: string) {
  const prisma = getPrisma();
  const photos = await prisma.cardPhoto.findMany({
    where: { inventoryItemId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  const ordered = orderListingPhotos(photos);
  if (ordered.length > 0) {
    await prisma.$transaction(
      ordered.map((photo, order) =>
        prisma.cardPhoto.update({
          where: { id: photo.id },
          data: { order },
        }),
      ),
    );
  }
  return prisma.cardPhoto.findMany({
    where: { inventoryItemId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}
