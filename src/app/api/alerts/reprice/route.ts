import { NextResponse } from "next/server";
import { z } from "zod";
import { runRepriceCheck } from "@/lib/alerts/repriceRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const repriceSchema = z.object({
  notify: z.boolean().default(false),
  limit: z.coerce.number().int().positive().max(25).default(10),
  thresholdPct: z.coerce.number().positive().max(100).default(10),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = repriceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid reprice request",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await runRepriceCheck(parsed.data));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "reprice check failed" },
      { status: 500 },
    );
  }
}
