import { NextResponse } from "next/server";
import {
  accountDeletionVerificationToken,
  buildAccountDeletionChallengeResponse,
  EBAY_ACCOUNT_DELETION_ENDPOINT,
} from "@/lib/ebay/accountDeletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = accountDeletionVerificationToken();
  if (!token) {
    return NextResponse.json(
      { error: "eBay account deletion verification token is not configured." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const challengeCode = url.searchParams.get("challenge_code");
  if (!challengeCode) {
    return NextResponse.json({ error: "Missing challenge_code." }, { status: 400 });
  }

  return NextResponse.json({
    challengeResponse: buildAccountDeletionChallengeResponse({
      challengeCode,
      verificationToken: token,
      endpoint: EBAY_ACCOUNT_DELETION_ENDPOINT,
    }),
  });
}

export async function POST() {
  // Poke Deal does not store marketplace buyer/user profiles from eBay. The
  // notification is acknowledged so eBay can keep the developer key compliant.
  return new Response(null, { status: 204 });
}
