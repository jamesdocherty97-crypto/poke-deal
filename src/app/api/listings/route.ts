import { NextResponse } from "next/server";
import { z } from "zod";
import { buildListingTitle } from "@/lib/dealer/listingDraft";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nullableUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().url().nullable().optional(),
);

const listingCreateSchema = z.object({
  itemId: z.string().min(1),
  channel: z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]).default("EBAY"),
  state: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
  listPricePence: z.coerce.number().int().nonnegative().nullable().optional(),
  externalUrl: nullableUrl,
});

export async function GET() {
  try {
    const listings = await getPrisma().listing.findMany({
      include: {
        item: {
          include: {
            card: true,
            sales: { orderBy: { soldAt: "desc" } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ listings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "listing lookup failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = listingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid listing create",
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
    const listing = await getPrisma().$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({
        where: { id: d.itemId },
        include: { card: true },
      });
      if (!item) return null;
      if (item.status === "SOLD") {
        throw new Error("Cannot create a listing for sold stock.");
      }

      const created = await tx.listing.create({
        data: {
          itemId: item.id,
          channel: d.channel,
          state: d.state,
          title: buildListingTitle(item.card, item.grade),
          suggestedPrice: d.listPricePence ?? null,
          listPrice: d.listPricePence ?? null,
          externalUrl: d.externalUrl ?? null,
          listedAt: d.state === "ACTIVE" ? new Date() : null,
        },
        include: {
          item: {
            include: {
              card: true,
              sales: { orderBy: { soldAt: "desc" } },
            },
          },
        },
      });

      if (d.state === "ACTIVE") {
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { status: "LISTED" },
        });
      }

      return created;
    });

    if (!listing) {
      return NextResponse.json({ error: "Stock row not found" }, { status: 404 });
    }

    return NextResponse.json({ listing }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "listing create failed" },
      { status: 500 },
    );
  }
}
