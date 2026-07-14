import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { getEbayConfig, isEbayConfigured } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { fetchEbayPolicies } from "@/lib/ebay/policies";
import { getOfferBySku } from "@/lib/ebay/offer";
import { buildEbayOfferPreflight, toEbaySku } from "@/lib/ebay/preflight";
import { synchronizeEbayOffer, validateEbayListPricePence } from "@/lib/ebay/offerSync";
import { ebayApiErrorLogBody, ebayApiErrorResponseBody, isEbayApiError } from "@/lib/ebay/errors";
import { photoRequirementMessage, summarizeListingPhotos } from "@/lib/photos/listingPhotoPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nullableText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().min(1).nullable().optional(),
);

const nullableUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().url().nullable().optional(),
);

const listingPatchSchema = z.object({
  channel: z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]).optional(),
  state: z.enum(["DRAFT", "ACTIVE", "ENDED"]).optional(),
  title: nullableText,
  description: nullableText,
  suggestedPricePence: z.coerce.number().int().nonnegative().nullable().optional(),
  listPricePence: z.coerce.number().int().nonnegative().nullable().optional(),
  externalRef: nullableText,
  externalUrl: nullableUrl,
});

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const body = await request.json().catch(() => null);
  const parsed = listingPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid listing update",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const d = parsed.data;
    const prisma = getPrisma();
    const existing = await prisma.listing.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    const effectiveChannel = d.channel ?? existing.channel;
    const effectiveListPrice =
      d.listPricePence !== undefined ? d.listPricePence : existing.listPrice;

    if (d.state === "ACTIVE" && (!effectiveListPrice || effectiveListPrice <= 0)) {
      return NextResponse.json(
        {
          error:
            "Choose Your list price before activating this listing. Suggested prices are guidance and are never sent automatically.",
        },
        { status: 400 },
      );
    }

    if (
      effectiveChannel === "EBAY" &&
      effectiveListPrice !== null &&
      effectiveListPrice < 99 &&
      (d.listPricePence !== undefined || d.channel !== undefined || d.state === "ACTIVE")
    ) {
      return NextResponse.json(
        {
          error:
            "Your eBay list price must be at least £0.99. This is the price buyers will see, not what you paid or the market comp.",
        },
        { status: 400 },
      );
    }

    // Guard: EBAY-channel listings must not be flipped to ACTIVE through this
    // generic patch unless they are genuinely live on eBay already. The real
    // publish flow (offer -> publish) sets state/externalRef/externalUrl
    // together via /api/listings/[id]/ebay/publish and never goes through
    // this route, so this only blocks bypasses (e.g. a stray "Activate"
    // button) from faking a live listing without ever calling eBay.
    if (d.state === "ACTIVE") {
      if (effectiveChannel === "EBAY") {
        const effectiveExternalRef = d.externalRef !== undefined ? d.externalRef : existing.externalRef;
        const effectiveExternalUrl = d.externalUrl !== undefined ? d.externalUrl : existing.externalUrl;
        const genuinelyLive = Boolean(
          effectiveExternalUrl && effectiveExternalRef && !effectiveExternalRef.startsWith("offer:"),
        );
        if (!genuinelyLive) {
          return NextResponse.json(
            {
              error:
                "EBAY listings can only be activated by publishing them on eBay (Create offer -> Publish) or by pasting a genuine live eBay URL. Use the eBay publish flow instead of marking active directly.",
            },
            { status: 400 },
          );
        }
      }
    }

    // A live eBay price edit is remote-first: eBay must accept the complete,
    // rebuilt offer before the local price can change. This prevents the app
    // claiming a price that buyers cannot actually see on the marketplace.
    let liveEbaySync: { offerId: string; pricePence: number; syncedAt: Date } | null = null;
    const editingLiveEbayPrice =
      effectiveChannel === "EBAY" &&
      existing.state === "ACTIVE" &&
      d.listPricePence !== undefined &&
      d.listPricePence !== existing.listPrice;

    if (editingLiveEbayPrice) {
      const priceError = validateEbayListPricePence(d.listPricePence);
      if (priceError) {
        return NextResponse.json({ error: priceError }, { status: 400 });
      }
      if (!isEbayConfigured()) {
        return NextResponse.json(
          { error: "eBay is not configured, so the live price was not changed." },
          { status: 503 },
        );
      }

      const current = await prisma.listing.findUnique({
        where: { id: params.id },
        include: {
          item: {
            include: {
              card: true,
              photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
            },
          },
        },
      });
      if (!current) {
        return NextResponse.json({ error: "Listing not found" }, { status: 404 });
      }

      const listPricePence = d.listPricePence!;
      const photoSummary = summarizeListingPhotos({
        photos: current.item.photos,
        grade: current.item.grade,
        pricePence: listPricePence,
      });
      if (!photoSummary.satisfiesEbayPhotoRequirement) {
        return NextResponse.json(
          {
            error: `${photoRequirementMessage(photoSummary)} The live price was not changed.`,
            canUseCatalogArt: photoSummary.catalogPhotoAllowed,
          },
          { status: 400 },
        );
      }

      const config = getEbayConfig()!;
      try {
        const accessToken = await getAccessToken(config);
        const policies = await fetchEbayPolicies(config, accessToken);
        const sku = toEbaySku(current.id, current.itemId);
        const offerId = current.ebayOfferId ?? await getOfferBySku(config, sku, accessToken);
        if (!offerId) {
          return NextResponse.json(
            {
              error:
                "This live eBay listing is not linked to an editable eBay offer. Its local price was not changed; edit it on eBay, then reconnect or refresh the listing.",
            },
            { status: 409 },
          );
        }

        const preflight = buildEbayOfferPreflight({
          listingId: current.id,
          itemId: current.itemId,
          title: current.title,
          description: current.description,
          packInput: {
            card: {
              name: current.item.card.name,
              setName: current.item.card.setName,
              number: current.item.card.number,
              rarity: current.item.card.rarity,
              language: current.item.card.language,
            },
            grade: current.item.grade,
            listPricePence,
            condition: current.item.condition ?? undefined,
            certNumber: current.item.graderCert ?? undefined,
            usesCatalogOnlyImages: photoSummary.catalogOnly,
          },
          quantity: current.item.quantity ?? 1,
          imageUrls: photoSummary.imageUrls,
          policies,
          config,
        });
        const synced = await synchronizeEbayOffer({
          config,
          accessToken,
          preflight,
          listPricePence,
          offerId,
        });
        liveEbaySync = {
          offerId: synced.offerId,
          pricePence: synced.syncedPricePence,
          syncedAt: new Date(),
        };
      } catch (err) {
        if (isEbayApiError(err)) {
          console.error("[ebay] live price sync failed", ebayApiErrorLogBody(err));
        }
        return NextResponse.json(
          ebayApiErrorResponseBody(err, "eBay rejected the price update; the local price was not changed"),
          { status: 502 },
        );
      }
    }

    const listing = await prisma.$transaction(async (tx) => {
      const current = await tx.listing.findUnique({
        where: { id: params.id },
        include: { item: true },
      });
      if (!current) return null;

      const data: Prisma.ListingUpdateInput = {
        channel: d.channel,
        title: d.title,
        description: d.description,
        suggestedPrice: d.suggestedPricePence,
        listPrice: d.listPricePence,
        externalRef: d.externalRef,
        externalUrl: d.externalUrl,
      };

      if (liveEbaySync) {
        data.ebayOfferId = liveEbaySync.offerId;
        data.offerSyncedAt = liveEbaySync.syncedAt;
        data.offerSyncedPrice = liveEbaySync.pricePence;
      }

      const pendingEbayOffer =
        effectiveChannel === "EBAY" &&
        Boolean(current.ebayOfferId || current.externalRef?.startsWith("offer:"));
      if (d.listPricePence !== undefined && pendingEbayOffer && !liveEbaySync) {
        data.offerSyncedAt = null;
        data.offerSyncedPrice = null;
      }

      if (d.state) {
        data.state = d.state;
        if (d.state === "ACTIVE") {
          data.listedAt = current.listedAt ?? new Date();
          data.endedAt = null;
        }
        if (d.state === "ENDED") {
          data.endedAt = current.endedAt ?? new Date();
        }
        if (d.state === "DRAFT") {
          data.endedAt = null;
        }
      }

      const updated = await tx.listing.update({
        where: { id: params.id },
        data,
        include: {
          item: {
            include: {
              card: true,
              sales: { orderBy: { soldAt: "desc" } },
              photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
            },
          },
        },
      });

      if (d.state === "ACTIVE" && updated.item.status !== "SOLD") {
        await tx.inventoryItem.update({
          where: { id: updated.itemId },
          data: { status: "LISTED" },
        });
      }

      if ((d.state === "DRAFT" || d.state === "ENDED") && updated.item.status === "LISTED") {
        const activeCount = await tx.listing.count({
          where: { itemId: updated.itemId, state: "ACTIVE" },
        });
        if (activeCount === 0) {
          await tx.inventoryItem.update({
            where: { id: updated.itemId },
            data: { status: "IN_STOCK" },
          });
        }
      }

      return updated;
    });

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    return NextResponse.json({ listing });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "listing update failed" },
      { status: 500 },
    );
  }
}
