// PSA cert lookup: GET /api/psa/cert?cert=79721014
// Returns normalized cert/grade/population data. Runs in fixture mode (a demo
// cert) until PSA_API_TOKEN is set, so the flow is usable offline.

import { NextResponse } from "next/server";
import { PsaCertLookup } from "@/lib/psa/psaCert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cert = searchParams.get("cert");
  if (!cert) {
    return NextResponse.json({ error: "cert is required" }, { status: 400 });
  }

  const lookup = new PsaCertLookup();
  const result = await lookup.lookup(cert);
  return NextResponse.json({ result, live: lookup.live });
}
