import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { realizedProfit } from "@/lib/comps/pricing";
import { planSaleListingClosure, planUnitSale, splitPence } from "@/lib/dealer/unitSale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sellSchema = z.object({
  channel: z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]).default("EBAY"),
  salePricePence: z.coerce.number().int().nonnegative(),
  feesPence: z.coerce.number().int().nonnegative().default(0),
  postagePence: z.coerce.number().int().nonnegative().default(0),
  quantity: z.coerce.number().int().positive().default(1),
  soldAt: z.coerce.date().optional(),
  listingId: z.string().trim().min(1).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const body = await request.json().catch(() => null);
  const parsed = sellSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid sale request",
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
      const item = await tx.inventoryItem.findUnique({
        where: { id: params.id },
        include: { card: true },
      });
      if (!item) throw new Error("Inventory item not found");
      const salePlan = planUnitSale({
        quantity: item.quantity,
        soldQuantity: d.quantity,
        status: item.status,
      });
      const soldAt = d.soldAt ?? new Date();
      const salePrices = splitPence(d.salePricePence, salePlan.soldQuantity);
      const fees = splitPence(d.feesPence, salePlan.soldQuantity);
      const postage = splitPence(d.postagePence, salePlan.soldQuantity);

      const sales = [];
      for (let index = 0; index < salePlan.soldQuantity; index += 1) {
        sales.push(
          await tx.sale.create({
            data: {
              itemId: item.id,
              channel: d.channel,
              salePrice: salePrices[index] ?? 0,
              fees: fees[index] ?? 0,
              postage: postage[index] ?? 0,
              soldAt,
            },
          }),
        );
      }

      const updatedItem = await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          quantity: salePlan.remainingQuantity,
          status: salePlan.status,
        },
        include: {
          card: true,
          listings: { orderBy: { createdAt: "desc" } },
          sales: { orderBy: { soldAt: "desc" } },
          photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
        },
      });

      const listingClosure = planSaleListingClosure({
        itemId: item.id,
        soldListingId: d.listingId,
        closeOpenListings: salePlan.closeOpenListings,
      });
      if (listingClosure?.kind === "all-open") {
        await tx.listing.updateMany({
          where: { itemId: listingClosure.itemId, state: { in: ["DRAFT", "ACTIVE"] } },
          data: { state: "SOLD", endedAt: soldAt },
        });
      } else if (listingClosure?.kind === "one") {
        await tx.listing.updateMany({
          where: {
            id: listingClosure.listingId,
            itemId: listingClosure.itemId,
            state: { in: ["DRAFT", "ACTIVE"] },
          },
          data: { state: "SOLD", endedAt: soldAt },
        });
      }

      return { item: updatedItem, sale: sales[0] ?? null, sales, salePlan };
    });

    const profitPence = result.sales.reduce(
      (sum, sale) =>
        sum +
        realizedProfit({
          salePrice: sale.salePrice,
          fees: sale.fees,
          postage: sale.postage,
          costBasis: result.item.costBasis,
        }),
      0,
    );

    return NextResponse.json(
      {
        ...result,
        profitPence,
        quantitySold: result.salePlan.soldQuantity,
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "mark sold failed" },
      { status: 500 },
    );
  }
}
