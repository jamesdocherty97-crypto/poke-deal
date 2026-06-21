// Vertical-slice API: GET /api/comps?name=Charizard ex&number=199/165&grade=RAW
// Returns the reconciled comp for a card+grade. Runs in fixture mode until keys are set.

import { NextResponse } from "next/server";
import { CompService } from "@/lib/comps/compService";
import { PrismaCompResultRepo } from "@/lib/comps/prismaCompResultRepo";
import type { CardRef, Grade } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const card: CardRef = {
    name,
    setName: searchParams.get("set") ?? undefined,
    number: searchParams.get("number") ?? undefined,
    game: "POKEMON",
    language: "EN",
  };
  const grade = (searchParams.get("grade") as Grade | null) ?? "RAW";

  try {
    const result = await CompService.default().lookup(card, { grade });
    if (process.env.DATABASE_URL) {
      await new PrismaCompResultRepo().create(result.headline).catch((err) => {
        console.warn(
          "[comps] comp persistence skipped:",
          err instanceof Error ? err.message : "unknown error",
        );
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed" },
      { status: 502 },
    );
  }
}
