import { NextResponse } from "next/server";
import {
  DEFAULT_DEAL_CALC_SETTINGS,
  dealCalc,
  normalizeDealCalcSettings,
  type DealCalcCompInput,
  type DealCalcOptions,
  type DealCalcSettingsInput,
} from "@/lib/dealer/dealCalc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON body is required" }, { status: 400 });
  }

  if (!isObject(body) || !isObject(body.comp)) {
    return NextResponse.json({ error: "comp is required" }, { status: 400 });
  }

  const comp = body.comp as unknown as DealCalcCompInput;
  const settings = isObject(body.settings)
    ? normalizeDealCalcSettings(body.settings as DealCalcSettingsInput)
    : DEFAULT_DEAL_CALC_SETTINGS;
  const options = isObject(body.options) ? (body.options as DealCalcOptions) : {};

  return NextResponse.json({ result: dealCalc(comp, settings, options) });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
