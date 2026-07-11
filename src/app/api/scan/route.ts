import { after, NextResponse } from "next/server";
import { MAX_SCAN_BODY_BYTES, readCardImage, ScanError } from "@/lib/scan/cardScan";
import { completeScanEvent, scanEventDataFromError, scanEventDataFromResult } from "@/lib/scan/scanEvent";
import { hashScanSession, reserveScanBudget, scanSessionTokenFromRequest } from "@/lib/scan/scanBudget";
import { readBoundedJson } from "@/lib/http/boundedJson";
import { recordSourceSuccess } from "@/lib/system/sourceFreshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScanBody = { imageBase64?: unknown; mimeType?: unknown };

export async function POST(request: Request) {
  const bounded = await readBoundedJson<ScanBody>(request, MAX_SCAN_BODY_BYTES);
  if (!bounded.ok) return NextResponse.json({ error: bounded.error }, { status: bounded.status });
  const imageBase64 = typeof bounded.value.imageBase64 === "string" ? bounded.value.imageBase64.trim() : "";
  const mimeType = typeof bounded.value.mimeType === "string" ? bounded.value.mimeType.trim() : "image/jpeg";
  if (!imageBase64) {
    return NextResponse.json({ error: "imageBase64 is required." }, { status: 400 });
  }
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mimeType)) {
    return NextResponse.json({ error: `Unsupported mimeType: ${mimeType}` }, { status: 400 });
  }

  const inputKind = cleanInputKind(request.headers.get("x-poke-deal-scan-input"));
  const sessionHash = hashScanSession(scanSessionTokenFromRequest(request));
  const reservation = await reserveScanBudget({
    sessionHash,
    requestBytes: bounded.bytes,
    inputKind,
  });
  if (!reservation.allowed) {
    const scope = reservation.reason === "session" ? "This device's daily" : "Daily";
    return NextResponse.json(
      { error: `${scope} scan budget reached — type the card instead (resets 8am UK).`, reason: reservation.reason },
      { status: 429 },
    );
  }

  const started = Date.now();
  const telemetry = () => ({
    latencyMs: Date.now() - started,
    requestBytes: bounded.bytes,
    inputKind,
    sessionHash,
  });
  try {
    const result = await readCardImage(imageBase64, mimeType, { signal: request.signal });
    recordSourceSuccess("gemini-scan");
    const eventData = scanEventDataFromResult(result, "gemini-scan", telemetry());
    after(() => completeScanEvent(reservation.eventId, eventData));
    console.info(JSON.stringify({
      event: "scan_verdict",
      status: result.identity.readable ? "READABLE" : "UNREADABLE",
      latencyMs: Date.now() - started,
      requestBytes: bounded.bytes,
      inputKind,
      model: result.model,
      usage: result.usage ?? null,
      budgetDurable: reservation.durable,
    }));
    return NextResponse.json({ ...result, scanEventId: reservation.eventId });
  } catch (err) {
    const eventData = scanEventDataFromError(err, "gemini-scan", telemetry());
    after(() => completeScanEvent(reservation.eventId, eventData));
    console.info(JSON.stringify({
      event: "scan_verdict",
      status: "ERROR",
      kind: err instanceof ScanError ? err.kind : "unknown",
      latencyMs: Date.now() - started,
      requestBytes: bounded.bytes,
      inputKind,
      budgetDurable: reservation.durable,
    }));
    if (err instanceof ScanError) {
      const status = err.kind === "config" ? 503 : err.kind === "quota" ? 429 : err.kind === "unreadable" ? 422 : 502;
      return NextResponse.json({ error: err.message, kind: err.kind, scanEventId: reservation.eventId }, { status });
    }
    return NextResponse.json({ error: "Scan failed.", scanEventId: reservation.eventId }, { status: 500 });
  }
}

function cleanInputKind(value: string | null): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^(camera|upload|offline-replay)$/.test(normalized) ? normalized : "image";
}
