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
