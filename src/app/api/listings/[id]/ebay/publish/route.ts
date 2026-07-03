import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { getEbayConfig, isEbayConfigured } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { publishEbayOffer } from "@/lib/ebay/offer";
import { fetchEbaySellingPrivileges } from "@/lib/ebay/policies";
import { fetchEbayPolicies } from "@/lib/ebay/policies";
import { readEbayLocationSetup } from "@/lib/ebay/location";
import { addTradingFixedPriceItem } from "@/lib/ebay/trading";
import { ebayApiErrorLogBody, ebayApiErrorResponseBody, isEbayApiError } from "@/lib/ebay/errors";
import { photoRequirementMessage, summarizeListingPhotos } from "@/lib/photos/listingPhotoPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ebayListingUrl(listingId: string): string {
  return `https://www.ebay.co.uk/itm/${listingId}`;
}

type PublishListing = {
  id: string;
  itemId: string;
  listPrice: number | null;
  suggestedPrice: number | null;
  item: {
    status: string;
    grade: string;
    condition: string | null;
    graderCert: string | null;
    quantity: number;
    card: {
      name: string;
      setName: string;
      number: string | null;
      rarity: string | null;
      language: string;
    };
    photos: Array<{ url: string; origin?: "REAL" | "CATALOG" | null; order?: number | null; createdAt?: Date | string | null }>;
  };
};

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  if (!isEbayConfigured()) {
    return NextResponse.json(
      { error: "eBay is not configured." },
      { status: 503 },
    );
  }

  const prisma = getPrisma();
  const listing = await prisma.listing.findUnique({
    where: { id: params.id },
    include: { item: { include: { card: true, photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] } } } },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }
  if (listing.channel !== "EBAY") {
    return NextResponse.json({ error: "Listing channel is not EBAY." }, { status: 400 });
  }
  if (listing.item.status === "SOLD") {
    return NextResponse.json({ error: "Item is already sold." }, { status: 400 });
  }

  const effectivePricePence = listing.listPrice ?? listing.suggestedPrice ?? 0;
  const photoSummary = summarizeListingPhotos({
    photos: listing.item.photos,
    grade: listing.item.grade,
    pricePence: effectivePricePence,
  });
  if (!photoSummary.satisfiesEbayPhotoRequirement) {
    return NextResponse.json(
      { error: photoRequirementMessage(photoSummary), canUseCatalogArt: photoSummary.catalogPhotoAllowed },
      { status: 400 },
    );
  }

  const offerId = listing.externalRef?.startsWith("offer:")
    ? listing.externalRef.slice("offer:".length)
    : null;

  const config = getEbayConfig()!;

  try {
    const accessToken = await getAccessToken(config);
    const privileges = await fetchEbaySellingPrivileges(config, accessToken);
    if (privileges.sellerRegistrationCompleted === false) {
      return await publishViaTradingApiFallback({
        listing,
        listingId: params.id,
        config,
        accessToken,
        prisma,
      });
    }

    if (!offerId) {
      return NextResponse.json(
        { error: "No pending eBay offer found. Create an offer first." },
        { status: 400 },
      );
    }

    const result = await publishEbayOffer(config, offerId, accessToken);
    const listingId = result.listingId;
    const listingUrl = ebayListingUrl(listingId);

    await prisma.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id: params.id },
        data: {
          state: "ACTIVE",
          externalRef: listingId,
          externalUrl: listingUrl,
          listedAt: new Date(),
        },
      });
      if (listing.item.status !== "SOLD") {
        await tx.inventoryItem.update({
          where: { id: listing.itemId },
          data: { status: "LISTED" },
        });
      }
    });

    return NextResponse.json({
      success: true,
      listingId,
      listingUrl,
      message: "Listing published on eBay.",
    });
  } catch (err) {
    if (isEbayApiError(err)) {
      console.error("[ebay] publish failed", ebayApiErrorLogBody(err));
    }
    return NextResponse.json(
      ebayApiErrorResponseBody(err, "eBay publish failed"),
      { status: 500 },
    );
  }
}

async function publishViaTradingApiFallback({
  listing,
  listingId,
  config,
  accessToken,
  prisma,
}: {
  listing: PublishListing;
  listingId: string;
  config: NonNullable<ReturnType<typeof getEbayConfig>>;
  accessToken: string;
  prisma: ReturnType<typeof getPrisma>;
}) {
  const effectivePricePence = listing.listPrice ?? listing.suggestedPrice ?? 0;
  if (effectivePricePence <= 0) {
    return NextResponse.json(
      { error: "Set a price on the listing before publishing to eBay." },
      { status: 400 },
    );
  }

  const photoSummary = summarizeListingPhotos({
    photos: listing.item.photos,
    grade: listing.item.grade,
    pricePence: effectivePricePence,
  });
  if (!photoSummary.satisfiesEbayPhotoRequirement) {
    return NextResponse.json(
      { error: photoRequirementMessage(photoSummary), canUseCatalogArt: photoSummary.catalogPhotoAllowed },
      { status: 400 },
    );
  }

  const policies = await fetchEbayPolicies(config, accessToken);
  const locationSetup = readEbayLocationSetup();
  let result;
  try {
    result = await addTradingFixedPriceItem(config, accessToken, {
      listingId: `pdos-${listing.itemId}`,
      packInput: {
        card: {
          name: listing.item.card.name,
          setName: listing.item.card.setName,
          number: listing.item.card.number,
          rarity: listing.item.card.rarity,
          language: listing.item.card.language,
        },
        grade: listing.item.grade,
        listPricePence: effectivePricePence,
        condition: listing.item.condition ?? undefined,
        certNumber: listing.item.graderCert ?? undefined,
        usesCatalogOnlyImages: photoSummary.catalogOnly,
      },
      quantity: listing.item.quantity ?? 1,
      imageUrls: photoSummary.imageUrls,
      policies,
      location: locationSetup?.address.city ?? null,
      postalCode: locationSetup?.address.postalCode ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "eBay publish failed";
    if (/additional information to create a seller'?s account|incomplete account information/i.test(message)) {
      console.error("[ebay] trading publish seller-account block", { error: message });
      return NextResponse.json(
        {
          error: `${message}. eBay is still blocking API listing until seller-account setup is complete. Publish one real listing manually in eBay, or complete any seller payments/identity prompt eBay shows, then try again in Poke Deal.`,
        },
        { status: 409 },
      );
    }
    throw err;
  }

  const ebayItemId = result.itemId;
  if (!ebayItemId) {
    return NextResponse.json(
      { error: "eBay published response did not include an item ID." },
      { status: 502 },
    );
  }

  const listingUrl = ebayListingUrl(ebayItemId);
  await prisma.$transaction(async (tx) => {
    await tx.listing.update({
      where: { id: listingId },
      data: {
        state: "ACTIVE",
        externalRef: ebayItemId,
        externalUrl: listingUrl,
        listedAt: new Date(),
      },
    });
    if (listing.item.status !== "SOLD") {
      await tx.inventoryItem.update({
        where: { id: listing.itemId },
        data: { status: "LISTED" },
      });
    }
  });

  return NextResponse.json({
    success: true,
    listingId: ebayItemId,
    listingUrl,
    publishMode: "trading-api",
    message: "Listing published on eBay.",
  });
}
