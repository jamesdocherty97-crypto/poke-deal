import { NextResponse } from "next/server";
import { backupStamp, createLedgerBackup } from "@/lib/backup/ledgerBackup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bundle = await createLedgerBackup();
    const stamp = backupStamp(bundle.createdAt);
    return new NextResponse(`${JSON.stringify(bundle, null, 2)}\n`, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="poke-deal-backup-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "backup failed" },
      { status: 500 },
    );
  }
}
