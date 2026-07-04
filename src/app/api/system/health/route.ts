import { NextResponse } from "next/server";
import { runDeepHealthCheck } from "@/lib/system/deepHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await runDeepHealthCheck();
  const hasRequiredFailure = report.sources.some((source) => source.required && source.status === "fail");
  return NextResponse.json(report, { status: hasRequiredFailure ? 503 : 200 });
}
