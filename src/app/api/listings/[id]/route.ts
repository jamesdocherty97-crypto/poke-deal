import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nullableText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().min(1).nullable().optional(),
);

const nullableUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().url().nullable().optional(),
);

const listingPatchSchema = z.object({
  channel: z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]).optional(),
  state: z.enum(["DRAFT", "ACTIVE", "ENDED"]).optional(),
  title: nullableText,
  description: nullableText,
  listPricePence: z.coerce.number().int().nonnegative().nullable().optional(),
  externalRef: nullableText,
  externalUrl: nullableUrl,
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const body = await request.json().catch(() => null);
  const parsed = listingPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid listing update",
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
    const prisma = getPrisma();
    const listing = await prisma.$transaction(async (tx) => {
      const current = await tx.listing.findUnique({
        where: { id: params.id },
        include: { item: true },
      });
      if (!current) return null;

      const data: Prisma.ListingUpdateInput = {
        channel: d.channel,
        title: d.title,
        description: d.description,
        listPrice: d.listPricePence,
        externalRef: d.externalRef,
        externalUrl: d.externalUrl,
      };

      if (d.state) {
        data.state = d.state;
        if (d.state === "ACTIVE") {
          data.listedAt = current.listedAt ?? new Date();
          data.endedAt = null;
        }
        if (d.state === "ENDED") {
          data.endedAt = current.endedAt ?? new Date();
        }
        if (d.state === "DRAFT") {
          data.endedAt = null;
        }
      }

      const updated = await tx.listing.update({
        where: { id: params.id },
        data,
        include: {
          item: {
            include: {
              card: true,
              sales: { orderBy: { soldAt: "desc" } },
            },
          },
        },
      });

      if (d.state === "ACTIVE" && updated.item.status !== "SOLD") {
        await tx.inventoryItem.update({
          where: { id: updated.itemId },
          data: { status: "LISTED" },
        });
      }

      if ((d.state === "DRAFT" || d.state === "ENDED") && updated.item.status === "LISTED") {
        const activeCount = await tx.listing.count({
          where: { itemId: updated.itemId, state: "ACTIVE" },
        });
        if (activeCount === 0) {
          await tx.inventoryItem.update({
            where: { id: updated.itemId },
            data: { status: "IN_STOCK" },
          });
        }
      }

      return updated;
    });

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    return NextResponse.json({ listing });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "listing update failed" },
      { status: 500 },
    );
  }
}
