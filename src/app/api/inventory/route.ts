import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { GRADE_VALUES } from "@/lib/domain/types";
import { PrismaInventoryRepo } from "@/lib/inventory/prismaInventoryRepo";
import type { InventoryItemDraft } from "@/lib/inventory/inventoryService";
import { readClientMutationId } from "@/lib/offline/clientMutation";
import {
  readCardPriceHistoryPreviews,
  type PriceHistoryPreviewDb,
} from "@/lib/comps/priceHistory";

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
    const prisma = getPrisma();
    const items = await prisma.inventoryItem.findMany({
      include: {
        card: true,
        listings: { orderBy: { createdAt: "desc" } },
        sales: { orderBy: { soldAt: "desc" } },
        photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: { createdAt: "desc" },
    });
    const previews = await readCardPriceHistoryPreviews(
      prisma as unknown as PriceHistoryPreviewDb,
      items.map((item) => ({ cardId: item.cardId, grade: item.grade })),
    ).catch((err) => {
      console.warn("[inventory] price-history previews skipped:", err instanceof Error ? err.message : "unknown error");
      return [];
    });
    return NextResponse.json({
      items,
      priceHistoryPreviews: Object.fromEntries(previews.map((preview) => [preview.key, preview])),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inventory lookup failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const mutation = readClientMutationId(request);
  if (!mutation.ok) return NextResponse.json({ error: mutation.error }, { status: 400 });
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
    if (mutation.value) {
      const existing = await getPrisma().inventoryItem.findUnique({
        where: { clientMutationId: mutation.value },
        include: { card: true },
      });
      if (existing) {
        return NextResponse.json({ item: inventoryRecord(existing), idempotent: true });
      }
    }
    const item = await new PrismaInventoryRepo().create({
      ...(parsed.data as InventoryItemDraft),
      clientMutationId: mutation.value ?? undefined,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (mutation.value) {
      const existing = await getPrisma().inventoryItem.findUnique({
        where: { clientMutationId: mutation.value },
        include: { card: true },
      }).catch(() => null);
      if (existing) {
        return NextResponse.json({ item: inventoryRecord(existing), idempotent: true });
      }
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inventory create failed" },
      { status: 500 },
    );
  }
}

function inventoryRecord(item: {
  id: string;
  card: {
    id: string;
    name: string;
    setName: string;
    number: string | null;
    tcgApiId: string | null;
    tcgDexId: string | null;
    game: "POKEMON" | "SOCCER";
    language: "EN" | "JP";
  };
  grade: InventoryItemDraft["grade"];
  quantity: number;
  costBasis: number;
  acquiredFrom: string | null;
  location: string | null;
  condition: string | null;
  graderCert: string | null;
  status: InventoryItemDraft["status"];
  clientMutationId: string | null;
  createdAt: Date;
}) {
  return {
    id: item.id,
    card: {
      id: item.card.id,
      name: item.card.name,
      setName: item.card.setName,
      number: item.card.number ?? undefined,
      tcgApiId: item.card.tcgApiId ?? undefined,
      tcgDexId: item.card.tcgDexId ?? undefined,
      game: item.card.game,
      language: item.card.language,
    },
    grade: item.grade,
    quantity: item.quantity,
    costBasisPence: item.costBasis,
    acquiredFrom: item.acquiredFrom ?? undefined,
    location: item.location ?? undefined,
    condition: item.condition ?? undefined,
    graderCert: item.graderCert ?? undefined,
    status: item.status,
    clientMutationId: item.clientMutationId ?? undefined,
    createdAt: item.createdAt.toISOString(),
  };
}
