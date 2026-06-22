import { NextResponse } from "next/server";
import { z } from "zod";
import { runWatchCheck } from "@/lib/alerts/watchRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkSchema = z.object({
  notify: z.boolean().default(false),
  limit: z.coerce.number().int().positive().max(25).default(10),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = checkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid watch check",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await runWatchCheck(parsed.data));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "watch check failed" },
      { status: 500 },
    );
  }
}
