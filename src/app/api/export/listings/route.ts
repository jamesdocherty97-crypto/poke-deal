import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { listingsToCsv, type ListingExportRecord } from "@/lib/exports/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"] as const;
const STATES = ["DRAFT", "ACTIVE", "SOLD", "ENDED"] as const;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel");
  const state = searchParams.get("state");

  if (channel && !CHANNELS.includes(channel as (typeof CHANNELS)[number])) {
    return NextResponse.json({ error: "invalid channel" }, { status: 400 });
  }
  if (state && !STATES.includes(state as (typeof STATES)[number])) {
    return NextResponse.json({ error: "invalid state" }, { status: 400 });
  }

  try {
    const listings = await getPrisma().listing.findMany({
      where: {
        ...(channel ? { channel: channel as (typeof CHANNELS)[number] } : {}),
        ...(state ? { state: state as (typeof STATES)[number] } : {}),
      },
      include: {
        item: {
          include: {
            card: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return csvResponse(
      listingsToCsv(listings as ListingExportRecord[]),
      `pokemon-dealer-listings-${dateStamp()}.csv`,
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "listing export failed" },
      { status: 500 },
    );
  }
}

function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
