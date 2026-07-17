import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { PrismaInventoryRepo } from "@/lib/inventory/prismaInventoryRepo";
import type { InventoryItemDraft } from "@/lib/inventory/inventoryService";
import { readClientMutationId } from "@/lib/offline/clientMutation";
import { inventoryDraftRequestSchema } from "@/lib/inventory/apiSchemas";
import { inventoryItemUiInclude } from "@/lib/inventory/apiRecord";
import {
  readCardPriceHistoryPreviews,
  type PriceHistoryPreviewDb,
} from "@/lib/comps/priceHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prisma = getPrisma();
    const items = await prisma.inventoryItem.findMany({
      include: inventoryItemUiInclude,
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
  const parsed = inventoryDraftRequestSchema.safeParse(body);
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
        include: inventoryItemUiInclude,
      });
      if (existing) {
        return NextResponse.json({ item: existing, idempotent: true });
      }
    }
    const created = await new PrismaInventoryRepo().create({
      ...(parsed.data as InventoryItemDraft),
      clientMutationId: mutation.value ?? undefined,
    });
    const item = await getPrisma().inventoryItem.findUnique({
      where: { id: created.id },
      include: inventoryItemUiInclude,
    });
    if (!item) throw new Error("Created inventory row could not be reloaded.");
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (mutation.value) {
      const existing = await getPrisma().inventoryItem.findUnique({
        where: { clientMutationId: mutation.value },
        include: inventoryItemUiInclude,
      }).catch(() => null);
      if (existing) {
        return NextResponse.json({ item: existing, idempotent: true });
      }
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inventory create failed" },
      { status: 500 },
    );
  }
}
