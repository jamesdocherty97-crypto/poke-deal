// Vertical-slice API: GET /api/catalog/sets
// Returns the bundled offline set catalog -- either the curated "popular
// sets" list (default) or the full 173-set snapshot (?all=1). Backs the
// set quick-pick chips and set-autocomplete dropdown on the frontend.
// Fully offline: reads the bundled snapshot in setCatalog.ts, no API key
// or network call required.

import { NextResponse } from "next/server";
import { getAllSets, getPopularSets } from "@/lib/catalog/setCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const all = searchParams.get("all");

  const sets = all ? getAllSets() : getPopularSets();
  return NextResponse.json({ sets });
}
