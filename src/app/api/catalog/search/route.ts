// Vertical-slice API: GET /api/catalog/search?q=base set
// Set autocomplete/search-as-you-type: ranks the bundled set catalog
// against freeform input (nickname, abbreviation, PTCGO code, or literal
// name) and returns the best matches. Fully offline, no API key required.

import { NextResponse } from "next/server";
import { searchSets } from "@/lib/catalog/setCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 8;

  const sets = searchSets(q, limit);
  return NextResponse.json({ sets });
}
