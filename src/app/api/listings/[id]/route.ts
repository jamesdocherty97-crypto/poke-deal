import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ebayListingIdFromUrl } from "@/lib/dealer/listingUrl";
import { getPrisma } from "@/lib/db/prisma";
import { getEbayConfig, isEbayConfigured } from "@/lib/ebay/config";
import { getAccessToken } from "@/lib/ebay/tokens";
import { withdrawEbayOffer } from "@/lib/ebay/offer";
import { activeListingEditError, planListingEnd } from "@/lib/dealer/listingEnd";
import { toEbaySku } from "@/lib/ebay/preflight";
import { buildListingPack } from "@/lib/dealer/listingPack";
import { editLiveEbayOffer, LiveEbayEditError, type LiveEbayEditField } from "@/lib/ebay/liveOfferEdit";
import { readBoundedJson } from "@/lib/http/boundedJson";
import {
  hasEbayOfferPresentationChanged,
  validateEbayListPricePence,
} from "@/lib/ebay/offerSync";
import { ebayApiErrorResponseBody } from "@/lib/ebay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nullableText = (maxLength: number) => z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().min(1).max(maxLength).nullable().optional(),
);

const nullableUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().url().nullable().optional(),
);

const listingPatchSchema = z.object({
  channel: z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]).optional(),
  state: z.enum(["DRAFT", "ACTIVE", "ENDED"]).optional(),
  title: nullableText(200),
  titleCustomized: z.boolean().optional(),
  description: nullableText(50_000),
  suggestedPricePence: z.coerce.number().int().nonnegative().max(2_147_483_647).nullable().optional(),
  listPricePence: z.coerce.number().int().nonnegative().max(2_147_483_647).nullable().optional(),
  externalRef: nullableText(200),
  externalUrl: nullableUrl,
  externalRemovalConfirmed: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const body = await readBoundedJson(request, 256 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = listingPatchSchema.safeParse(body.value);
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

  let liveEbaySync: {
    offerId: string;
    pricePence: number;
    syncedAt: Date;
    title?: string;
    description?: string;
    titleCustomized: boolean;
    fields: LiveEbayEditField[];
  } | null = null;
  try {
    const d = parsed.data;
    const prisma = getPrisma();
    const existing = await prisma.listing.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    const editError = activeListingEditError(existing, d);
    if (editError) return NextResponse.json({ error: editError }, { status: 409 });
    if (d.state === "ENDED" && existing.state !== "ENDED" && Object.keys(d).some((key) => key !== "state" && key !== "externalRemovalConfirmed")) {
      return NextResponse.json({ error: "Use the End listing control to remove this listing, then edit its saved details separately." }, { status: 400 });
    }
    if (d.state === "ACTIVE" && existing.state === "ENDED" && existing.channel === "EBAY") {
      return NextResponse.json({ error: "This eBay listing was ended. Use Review & publish to put its offer live again." }, { status: 409 });
    }
    if (existing.state === "SOLD" && d.state && d.state !== "ENDED") {
      return NextResponse.json({ error: "A sold listing cannot be reactivated. Restore stock through the sale correction flow first." }, { status: 409 });
    }
    if (d.state === "ENDED") {
      const endPlan = planListingEnd({ ...existing, externalRemovalConfirmed: d.externalRemovalConfirmed });
      if (endPlan === "confirm-removal") {
        return NextResponse.json({
          error: "Remove this listing on its marketplace, then use Confirm removed in Listings. It stays active here until you confirm removal.",
        }, { status: 409 });
      }
      if (endPlan === "withdraw-ebay") {
        const config = getEbayConfig();
        if (!config || !isEbayConfigured()) {
          return NextResponse.json({ error: "eBay is unavailable. The listing remains active. Reconnect eBay or remove it there and confirm removal in Listings." }, { status: 503 });
        }
        try {
          const accessToken = await getAccessToken(config);
          await withdrawEbayOffer(config, existing.ebayOfferId!, accessToken);
        } catch (err) {
          return NextResponse.json({
            ...ebayApiErrorResponseBody(err, "eBay withdrawal failed"),
            error: `${err instanceof Error ? err.message : "eBay withdrawal failed"}. The listing remains active here; retry or remove it on eBay and confirm removal.`,
          }, { status: 502 });
        }
      }
    }
    const effectiveChannel = d.channel ?? existing.channel;
    if (effectiveChannel === "EBAY" && d.title && d.title.length > 80) {
      return NextResponse.json({ error: "The eBay title must be 80 characters or fewer." }, { status: 400 });
    }
    if (effectiveChannel === "EBAY" && d.externalUrl && existing.state !== "ACTIVE") {
      const itemReference = ebayListingIdFromUrl(d.externalUrl);
      if (!itemReference) return NextResponse.json({ error: "Paste the individual live eBay item URL, not a search or seller page." }, { status: 400 });
      if (d.externalRef && d.externalRef !== itemReference) return NextResponse.json({ error: "The eBay item reference does not match its URL." }, { status: 400 });
      d.externalRef = itemReference;
    }
    const effectiveListPrice =
      d.listPricePence !== undefined ? d.listPricePence : existing.listPrice;
    const effectiveTitle = d.title !== undefined ? d.title : existing.title;
    const effectiveTitleCustomized =
      d.titleCustomized ?? (d.title !== undefined ? Boolean(d.title) : existing.titleCustomized);
    const effectiveDescription = d.description !== undefined ? d.description : existing.description;
    const ebayOfferPresentationChanged = hasEbayOfferPresentationChanged(
      {
        listPricePence: existing.listPrice,
        title: existing.title,
        titleCustomized: existing.titleCustomized,
        description: existing.description,
      },
      {
        listPricePence: effectiveListPrice,
        title: effectiveTitle,
        titleCustomized: effectiveTitleCustomized,
        description: effectiveDescription,
      },
    );

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
    // reviewed publish flow sets state/externalRef/externalUrl
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
                "EBAY listings can only be activated through Review & publish or by pasting a genuine live eBay URL. Use the eBay publish flow instead of marking active directly.",
            },
            { status: 400 },
          );
        }
      }
    }

    // Keep live changes narrow, preserving eBay's current photos, quantity,
    // condition and policies. Only persist buyer-facing edits after acceptance.
    const editingLiveEbayOffer =
      effectiveChannel === "EBAY" &&
      existing.channel === "EBAY" &&
      existing.state === "ACTIVE" &&
      (ebayOfferPresentationChanged || d.title !== undefined || d.titleCustomized !== undefined || d.description !== undefined || d.listPricePence !== undefined);

    if (editingLiveEbayOffer) {
      if (d.listPricePence !== undefined) {
        const priceError = validateEbayListPricePence(d.listPricePence);
        if (priceError) return NextResponse.json({ error: priceError }, { status: 400 });
      }
      if (d.description === null) {
        return NextResponse.json({ error: "Enter the description you want buyers to see. A live eBay description cannot be cleared without reviewed replacement text." }, { status: 400 });
      }
      if (d.title === null && d.titleCustomized !== false) {
        return NextResponse.json({ error: "Enter the title you want buyers to see. A live eBay title cannot be blank." }, { status: 400 });
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
      if (current.state !== "ACTIVE" || current.channel !== "EBAY" || current.item.status === "SOLD" || current.item.quantity <= 0) {
        return NextResponse.json({ error: "This listing no longer has available stock to edit. Refresh Listings before continuing." }, { status: 409 });
      }
      // A pasted live URL does not prove that an old offer for this SKU owns it.
      // Require the stored association instead of inferring one from the SKU.
      const offerId = current.ebayOfferId;
      if (!offerId) {
        return NextResponse.json(
          { error: "This live eBay listing is tracked manually and has no linked editable offer. The app was not changed; edit it on eBay." },
          { status: 409 },
        );
      }
      if (!isEbayConfigured()) {
        return NextResponse.json(
          { error: "eBay is not configured, so the live listing was not changed." },
          { status: 503 },
        );
      }

      const config = getEbayConfig()!;
      try {
        const accessToken = await getAccessToken(config);
        const sku = toEbaySku(current.id, current.itemId);
        const pack = buildListingPack({
            card: {
              name: current.item.card.name,
              setName: current.item.card.setName,
              number: current.item.card.number,
              rarity: current.item.card.rarity,
              language: current.item.card.language,
              edition: current.item.card.edition,
              finish: current.item.card.finish,
            },
            grade: current.item.grade,
            condition: current.item.condition ?? undefined,
            certNumber: current.item.graderCert ?? undefined,
        });
        // Explicit fields are intentional even when they equal stale local
        // values: the editor starts from the current remote snapshot.
        const titleChanged = d.title !== undefined || d.titleCustomized !== undefined;
        const descriptionChanged = d.description !== undefined;
        const changes = {
          ...(titleChanged ? { title: effectiveTitleCustomized && effectiveTitle ? effectiveTitle : pack.title } : {}),
          ...(descriptionChanged ? { description: d.description! } : {}),
          ...(d.listPricePence !== undefined ? { listPricePence: d.listPricePence! } : {}),
        };
        if (!current.externalRef || ebayListingIdFromUrl(current.externalUrl ?? "") !== current.externalRef) {
          return NextResponse.json({ error: "The saved eBay item reference and URL do not match. No update was sent; check the listing on eBay." }, { status: 409 });
        }
        const synced = await editLiveEbayOffer({
          config,
          accessToken,
          offerId,
          listingId: current.externalRef,
          sku,
          changes,
        });
        liveEbaySync = {
          offerId,
          pricePence: synced.snapshot.listPricePence,
          syncedAt: new Date(),
          title: synced.snapshot.title,
          description: synced.snapshot.description,
          titleCustomized: titleChanged ? effectiveTitleCustomized : existing.titleCustomized || synced.snapshot.title !== existing.title,
          fields: synced.fields,
        };
      } catch (err) {
        if (err instanceof LiveEbayEditError) {
          return NextResponse.json({ error: err.message, remoteUpdate: {
            status: err.confirmedFields.length ? "partial" : "unconfirmed",
            confirmedFields: err.confirmedFields,
            attemptedFields: err.attemptedFields,
          } }, { status: err.status });
        }
        return NextResponse.json(
          { ...ebayApiErrorResponseBody(err, "Could not read the current eBay listing; no update was sent."), remoteUpdate: { status: "unconfirmed", confirmedFields: [], attemptedFields: [] } },
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
      if (liveEbaySync && (current.state !== "ACTIVE" || current.channel !== "EBAY" ||
          current.item.status === "SOLD" || current.item.quantity <= 0 ||
          current.ebayOfferId !== existing.ebayOfferId || current.externalRef !== existing.externalRef ||
          current.title !== existing.title || current.titleCustomized !== existing.titleCustomized ||
          current.description !== existing.description || current.listPrice !== existing.listPrice)) {
        throw new Error("This listing changed while eBay was updating. Refresh Listings and check the live item before continuing.");
      }
      if (d.state === "ACTIVE" && current.item.status === "SOLD") {
        throw new Error("Sold stock cannot be activated on a marketplace.");
      }

      const data: Prisma.ListingUpdateInput = {
        channel: d.channel,
        title: d.title,
        titleCustomized: d.titleCustomized ?? (d.title !== undefined ? Boolean(d.title) : undefined),
        description: d.description,
        suggestedPrice: d.suggestedPricePence,
        listPrice: d.listPricePence,
        externalRef: d.externalRef,
        externalUrl: d.externalUrl,
      };

      if (effectiveChannel === "EBAY" && current.state !== "ACTIVE" &&
          d.externalRef !== undefined && d.externalRef !== current.externalRef) {
        // Adopting another live item must not make its price edits or removal
        // target a previously prepared, unrelated offer.
        data.ebayOfferId = null;
        data.offerSyncedAt = null;
        data.offerSyncedPrice = null;
      }

      if (liveEbaySync) {
        data.ebayOfferId = liveEbaySync.offerId;
        data.offerSyncedAt = liveEbaySync.syncedAt;
        data.offerSyncedPrice = liveEbaySync.pricePence;
        data.listPrice = liveEbaySync.pricePence;
        if (liveEbaySync.title !== undefined) {
          data.title = liveEbaySync.title;
          data.titleCustomized = liveEbaySync.titleCustomized;
        }
        if (liveEbaySync.description !== undefined) data.description = liveEbaySync.description;
      }

      const pendingEbayOffer =
        effectiveChannel === "EBAY" &&
        Boolean(current.ebayOfferId || current.externalRef?.startsWith("offer:"));
      if (ebayOfferPresentationChanged && pendingEbayOffer && !liveEbaySync) {
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
      if (liveEbaySync) throw new Error("The app listing was removed while eBay was updating.");
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    return NextResponse.json({ listing, ...(liveEbaySync ? { remoteUpdate: { status: "confirmed", fields: liveEbaySync.fields } } : {}) });
  } catch (err) {
    if (liveEbaySync) return NextResponse.json({
      error: `eBay accepted the changes, but the app could not save them. Refresh Listings and check the live item before retrying. ${err instanceof Error ? err.message : ""}`,
      remoteUpdate: { status: "partial", confirmedFields: liveEbaySync.fields, attemptedFields: [], localSaved: false },
    }, { status: 502 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "listing update failed" },
      { status: 500 },
    );
  }
}
