import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { GRADE_VALUES } from "@/lib/domain/types";
import { PrismaInventoryRepo } from "@/lib/inventory/prismaInventoryRepo";
import type { InventoryItemDraft } from "@/lib/inventory/inventoryService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gradeSchema = z.enum(GRADE_VALUES);

const cardSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  setName: z.string().min(1).optional(),
  number: z.string().min(1).optional(),
  tcgApiId: z.string().min(1).optional(),
  game: z.enum(["POKEMON", "SOCCER"]).default("POKEMON"),
  language: z.enum(["EN", "JP"]).default("EN"),
});

const inventoryDraftSchema = z.object({
  card: cardSchema,
  grade: gradeSchema.default("RAW"),
  quantity: z.coerce.number().int().positive().default(1),
  costBasisPence: z.coerce.number().int().nonnegative(),
  acquiredFrom: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  condition: z.string().trim().min(1).optional(),
  graderCert: z.string().trim().min(1).optional(),
  status: z.enum(["IN_STOCK", "LISTED", "SOLD", "RESERVED"]).default("IN_STOCK"),
});

export async function GET() {
  try {
    const items = await getPrisma().inventoryItem.findMany({
      include: {
        card: true,
        listings: { orderBy: { createdAt: "desc" } },
        sales: { orderBy: { soldAt: "desc" } },
        photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inventory lookup failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = inventoryDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid inventory item",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const item = await new PrismaInventoryRepo().create(parsed.data as InventoryItemDraft);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inventory create failed" },
      { status: 500 },
    );
  }
}
