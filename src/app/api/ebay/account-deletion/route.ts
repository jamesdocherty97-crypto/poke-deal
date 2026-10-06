import { NextResponse } from "next/server";
import {
  accountDeletionVerificationToken,
  buildAccountDeletionChallengeResponse,
  EBAY_ACCOUNT_DELETION_ENDPOINT,
  ebayAccountDeletionScrubEnabled,
  type EbayAccountDeletionNotification,
  readEbayAccountDeletionIdentifiers,
  scrubDeletedEbayAccountPayloads,
  verifyEbayNotificationSignature,
} from "@/lib/ebay/accountDeletion";
import { getEbayConfig } from "@/lib/ebay/config";
import { readBoundedJson } from "@/lib/http/boundedJson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_NOTIFICATION_BODY_BYTES = 256 * 1024;

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

export async function POST(request: Request) {
  const config = getEbayConfig();
  if (!config) return NextResponse.json({ error: "eBay is not configured." }, { status: 503 });

  const signatureHeader = request.headers.get("x-ebay-signature")?.trim();
  if (!signatureHeader) return NextResponse.json({ error: "Missing eBay signature." }, { status: 412 });

  const body = await readBoundedJson<EbayAccountDeletionNotification>(request, MAX_NOTIFICATION_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const message = body.value;

  try {
    const verified = await verifyEbayNotificationSignature({ message, signatureHeader, config });
    if (!verified) return NextResponse.json({ error: "Invalid eBay signature." }, { status: 412 });

    const identifiers = readEbayAccountDeletionIdentifiers(message);
    if (identifiers.length === 0) {
      return NextResponse.json({ error: "Invalid account deletion notification." }, { status: 400 });
    }

    // Default: acknowledge the verified notification without touching the
    // database. eBay sends these roughly once a minute, and a DB read here
    // kept the Neon compute awake around the clock. Since 2026-07-17 order
    // imports store only a minimised projection with no buyer identifiers,
    // and legacy full payloads are cleared by a one-off ops step. Prisma is
    // imported lazily so this path never even constructs a client.
    // Set EBAY_DELETION_SCRUB=1 to restore the historical payload scrub.
    if (!ebayAccountDeletionScrubEnabled()) {
      console.info(JSON.stringify({
        event: "ebay_account_deletion_acknowledged",
        notificationId: message.notification?.notificationId ?? null,
        scrub: "disabled",
      }));
      return new Response(null, { status: 204 });
    }

    const { getPrisma } = await import("@/lib/db/prisma");
    const scrubbedPayloads = await scrubDeletedEbayAccountPayloads(getPrisma(), identifiers);
    console.info(JSON.stringify({
      event: "ebay_account_deletion_processed",
      notificationId: message.notification?.notificationId ?? null,
      scrubbedPayloads,
    }));
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[ebay-account-deletion] processing failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Account deletion processing failed." }, { status: 503 });
  }
}
