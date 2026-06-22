import { NextResponse } from "next/server";
import { z } from "zod";
import { readPortfolioHistory, runPortfolioSnapshot } from "@/lib/snapshots/portfolioRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const snapshotSchema = z.object({
  limit: z.coerce.number().int().positive().max(25).default(25),
});

export async function GET() {
  try {
    const summary = await readPortfolioHistory();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "portfolio snapshot lookup failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid snapshot request",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await runPortfolioSnapshot({ limit: parsed.data.limit }));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "portfolio snapshot failed" },
      { status: 500 },
    );
  }
}
