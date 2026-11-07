import { NextResponse } from "next/server";
import { dryRunInventoryV1, type InventoryWriteRepo } from "@/lib/exports/inventoryV1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DRY_RUN_BYTES = 5 * 1024 * 1024;
const NO_DATABASE: InventoryWriteRepo = Object.freeze({});

export async function POST(request: Request) {
  const body = await readBoundedBytes(request, MAX_DRY_RUN_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      {
        ok: false,
        rowCount: 0,
        errorCount: 1,
        errors: [{ line: 1, message: body.error }],
        rows: [],
        writes: 0,
      },
      { status: body.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const report = dryRunInventoryV1(body.value, NO_DATABASE);
  return NextResponse.json({ ...report, writes: 0 }, { headers: { "Cache-Control": "no-store" } });
}

async function readBoundedBytes(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: Uint8Array } | { ok: false; status: 400 | 413; error: string }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: "Request body is too large." };
  }
  if (!request.body) return { ok: false, status: 400, error: "Request body is required." };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel("body limit exceeded").catch(() => undefined);
      return { ok: false, status: 413, error: "Request body is too large." };
    }
    chunks.push(value);
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: body };
}
