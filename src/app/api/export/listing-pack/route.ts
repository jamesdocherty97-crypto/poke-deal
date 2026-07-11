// Listing-pack CSV export: GET /api/export/listing-pack
// Builds a channel-ready listing pack CSV for every IN_STOCK / LISTED item. Saved
// draft/active listing prices are used exactly; otherwise the pack falls back to
// cost + margin. Works without eBay credentials, and the eBay Sell API draft-push
// can reuse buildListingPack() later.

import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import {
  buildListingPackCsv,
  type ListingPackChannel,
  type ListingPackInput,
} from "@/lib/dealer/listingPack";
import { listingEvidenceFromPreview } from "@/lib/dealer/listingEvidence";
import {
  cardGradeHistoryKey,
  readCardPriceHistoryPreviews,
  type PriceHistoryPreviewDb,
} from "@/lib/comps/priceHistory";
import type { Grade } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  try {
    const targetChannel = listingPackChannel(new URL(request.url).searchParams.get("channel"));
    const prisma = getPrisma() as unknown as {
      inventoryItem: {
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
      };
    };

    const items = await prisma.inventoryItem.findMany({
      where: { status: { in: ["IN_STOCK", "LISTED"] } },
      include: {
        card: true,
        listings: {
          where: { state: { in: ["DRAFT", "ACTIVE"] } },
          orderBy: { updatedAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const previews = await readCardPriceHistoryPreviews(
      prisma as unknown as PriceHistoryPreviewDb,
      items.flatMap((item) => {
        const cardId = typeof item.cardId === "string" ? item.cardId : null;
        const grade = typeof item.grade === "string" ? item.grade as Grade : null;
        return cardId && grade ? [{ cardId, grade }] : [];
      }),
    ).catch((err) => {
      console.warn("[listing-pack export] sold evidence skipped:", err instanceof Error ? err.message : "unknown error");
      return [];
    });
    const previewByKey = Object.fromEntries(previews.map((preview) => [preview.key, preview]));

    const inputs: ListingPackInput[] = items.map((item) => {
      const card = (item.card ?? {}) as Record<string, unknown>;
      const grade = String(item.grade ?? "RAW") as Grade;
      const cardId = typeof item.cardId === "string" ? item.cardId : null;
      const listing = preferredListing(item.listings, targetChannel);
      return {
        channel: targetChannel,
        card: {
          name: String(card.name ?? "Unknown card"),
          setName: (card.setName as string | null) ?? null,
          number: (card.number as string | null) ?? null,
          rarity: (card.rarity as string | null) ?? null,
          language: (card.language as string | null) ?? "EN",
        },
        grade,
        listPricePence: listingPricePence(listing),
        ...(cardId ? listingEvidenceFromPreview(previewByKey[cardGradeHistoryKey(cardId, grade)]) : {}),
        costBasisPence: numberOrUndefined(item.costBasis),
        condition: (item.condition as string | null) ?? null,
        certNumber: (item.graderCert as string | null) ?? null,
      };
    });

    const csv = buildListingPackCsv(inputs);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="listing-pack-${targetChannel.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "export failed" },
      { status: 500 },
    );
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function preferredListing(listings: unknown, channel: ListingPackChannel): Record<string, unknown> | undefined {
  if (!Array.isArray(listings)) return undefined;

  return listings
    .map((listing) => {
      const row = listing as Record<string, unknown>;
      return {
        row,
        channel: row.channel,
        stateRank: row.state === "ACTIVE" ? 0 : row.state === "DRAFT" ? 1 : 2,
        updatedAt: Date.parse(String(row.updatedAt ?? row.createdAt ?? "")) || 0,
      };
    })
    .filter((listing) => listing.channel === channel)
    .sort((a, b) => a.stateRank - b.stateRank || b.updatedAt - a.updatedAt)[0]?.row;
}

function listingPricePence(listing: Record<string, unknown> | undefined): number | undefined {
  return numberOrUndefined(listing?.listPrice) ?? numberOrUndefined(listing?.suggestedPrice);
}

function listingPackChannel(value: string | null): ListingPackChannel {
  if (value === "CARDMARKET" || value === "VINTED" || value === "IN_PERSON") return value;
  return "EBAY";
}
