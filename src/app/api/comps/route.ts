// Backward-compatible monolithic comp endpoint. The progressive sibling route
// shares the exact lookup implementation and final receipt shape.

import { after, NextResponse } from "next/server";
import { AppCompLookupError, runAppCompLookup } from "@/lib/comps/appCompLookupFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const receipt = await runAppCompLookup(new URL(request.url).searchParams, {
      signal: request.signal,
      defer: (work) => after(work),
    });
    return NextResponse.json(receipt);
  } catch (err) {
    const status = err instanceof AppCompLookupError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed" },
      { status },
    );
  }
}
