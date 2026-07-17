// Vertical-slice API: GET /api/catalog/sets
// Returns the bundled offline set catalog -- either the curated "popular
// sets" list (default), the full snapshot (?all=1), or both in one request
// (?bundle=1). Backs the
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
  const bundle = searchParams.get("bundle");

  if (bundle) {
    return NextResponse.json({ popularSets: getPopularSets(), sets: getAllSets() });
  }

  const sets = all ? getAllSets() : getPopularSets();
  return NextResponse.json({ sets });
}
