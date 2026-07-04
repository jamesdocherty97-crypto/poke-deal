import { NextResponse } from "next/server";
import { readCardImage, ScanError } from "@/lib/scan/cardScan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight per-instance daily guard. The Gemini free tier allows 1,500/day;
// this soft cap keeps a single runaway client from burning the whole budget.
// A durable cross-instance budget lands with the full scan feature.
const DAILY_SOFT_CAP = 600;
let dayKey = "";
let dayCount = 0;

function underBudget(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
  }
  return dayCount < DAILY_SOFT_CAP;
}

export async function POST(request: Request) {
  let body: { imageBase64?: string; mimeType?: string };
  try {
    body = (await request.json()) as { imageBase64?: string; mimeType?: string };
  } catch {
    return NextResponse.json({ error: "Body must be JSON with imageBase64 and mimeType." }, { status: 400 });
  }
  const imageBase64 = body.imageBase64?.trim();
  const mimeType = body.mimeType?.trim() ?? "image/jpeg";
  if (!imageBase64) {
    return NextResponse.json({ error: "imageBase64 is required." }, { status: 400 });
  }
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mimeType)) {
    return NextResponse.json({ error: `Unsupported mimeType: ${mimeType}` }, { status: 400 });
  }
  if (!underBudget()) {
    return NextResponse.json(
      { error: "Daily scan budget reached — type the card instead (resets 8am UK)." },
      { status: 429 },
    );
  }

  try {
    dayCount += 1;
    const result = await readCardImage(imageBase64, mimeType);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ScanError) {
      const status = err.kind === "config" ? 503 : err.kind === "quota" ? 429 : err.kind === "unreadable" ? 422 : 502;
      return NextResponse.json({ error: err.message, kind: err.kind }, { status });
    }
    return NextResponse.json({ error: "Scan failed." }, { status: 500 });
  }
}
