import { NextResponse } from "next/server";
import { z } from "zod";
import { ebayListingIdFromUrl } from "@/lib/dealer/listingUrl";
import { buildListingTitle } from "@/lib/dealer/listingDraft";
import { readClientMutationId } from "@/lib/offline/clientMutation";
import { readBoundedJson } from "@/lib/http/boundedJson";
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
  suggestedPricePence: z.coerce.number().int().nonnegative().nullable().optional(),
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
            photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
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
  const mutation = readClientMutationId(request);
  if (!mutation.ok) return NextResponse.json({ error: mutation.error }, { status: 400 });
  const body = await readBoundedJson(request, 16_384);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = listingCreateSchema.safeParse(body.value);
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

  const d = parsed.data;
  const clientMutationId = mutation.value;
  const replay = async () => {
    if (!clientMutationId) return null;
    const existing = await getPrisma().listing.findUnique({
      where: { clientMutationId },
      include: { item: { include: { card: true, sales: true, photos: true } } },
    });
    if (!existing) return null;
    if (existing.itemId !== d.itemId || existing.channel !== d.channel) {
      return NextResponse.json({ error: "This import identifier already belongs to a different stock row or channel." }, { status: 409 });
    }
    return NextResponse.json({ listing: existing, idempotent: true });
  };
  try { const previous = await replay(); if (previous) return previous; }
  catch { return NextResponse.json({ error: "Could not check saved listing progress. Retry with the same import." }, { status: 503 }); }

  if (d.state === "ACTIVE" && (!d.listPricePence || d.listPricePence <= 0)) {
    return NextResponse.json(
      {
        error:
          "Choose Your list price before activating this listing. Suggested prices are guidance and are never sent automatically.",
      },
      { status: 400 },
    );
  }

  if (d.channel === "EBAY" && d.listPricePence != null && d.listPricePence < 99) {
    return NextResponse.json(
      {
        error:
          "Your eBay list price must be at least £0.99. This is the price buyers will see, not what you paid or the market comp.",
      },
      { status: 400 },
    );
  }

  // Guard: a brand-new EBAY listing can only be created ACTIVE if a genuine
  // live eBay URL is supplied with it (e.g. tracking a listing made outside
  // the app). Otherwise it must start as DRAFT and go through the real
  // reviewed publish flow before it can become ACTIVE.
  if (d.state === "ACTIVE" && d.channel === "EBAY" && !ebayListingIdFromUrl(d.externalUrl)) {
    return NextResponse.json(
      {
        error:
          "New EBAY listings must start as DRAFT and be activated via Review & publish, unless you provide a genuine live eBay URL.",
      },
      { status: 400 },
    );
  }

  try {
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
          clientMutationId,
          channel: d.channel,
          state: d.state,
          title: buildListingTitle(item.card, item.grade, item.condition),
          titleCustomized: false,
          suggestedPrice: d.suggestedPricePence ?? null,
          listPrice: d.listPricePence ?? null,
          externalUrl: d.externalUrl ?? null,
          externalRef: d.channel === "EBAY" ? ebayListingIdFromUrl(d.externalUrl) : null,
          listedAt: d.state === "ACTIVE" ? new Date() : null,
        },
        include: {
          item: {
            include: {
              card: true,
              sales: { orderBy: { soldAt: "desc" } },
              photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
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
    // Concurrent or lost-response retry: the unique ID owns the committed draft.
    try { const previous = await replay(); if (previous) return previous; } catch { /* Return the original write failure. */ }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "listing create failed" },
      { status: 500 },
    );
  }
}
