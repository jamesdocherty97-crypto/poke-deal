import { NextResponse } from "next/server";
import { z } from "zod";
import { inboxUnreadCount } from "@/lib/alerts/inbox";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

export async function GET() {
  try {
    const alerts = await getPrisma().appAlert.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      alerts,
      unreadCount: inboxUnreadCount(alerts),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "alert inbox lookup failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid alert inbox update", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const now = new Date();
    const where = parsed.data.all
      ? { readAt: null }
      : { id: { in: parsed.data.ids ?? [] } };

    if (!parsed.data.all && (parsed.data.ids ?? []).length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    const result = await getPrisma().appAlert.updateMany({
      where,
      data: { readAt: now },
    });
    return NextResponse.json({ updated: result.count, readAt: now.toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "alert inbox update failed" },
      { status: 500 },
    );
  }
}
