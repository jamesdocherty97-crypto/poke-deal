"use client";

import type { FormEvent, ReactNode } from "react";
import type { ListingSort, ListingStateFilter } from "@/lib/dealer/tableControls";
import { buildListingEconomics } from "@/lib/dealer/listingEconomics";
import { InventoryPhotoTools } from "./InventoryPhotoTools";
import { CardImage, EmptyState, Metric } from "./UiBits";

type Channel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
type ItemStatus = "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
type ListingState = "DRAFT" | "ACTIVE" | "SOLD" | "ENDED";

type InventoryItem = any;
type Listing = any;

type Dashboard = {
  listingsByState: Record<string, number>;
};

type EbayStatus = {
  configured: boolean;
  connected: boolean;
};

export function ListingsTab({
  dashboard,
  firstDraftListingTarget,
  firstSaleListingTarget,
  unlistedStock,
  visibleUnlistedStock,
  activeListingCount,
  draftListingCount,
  listingQuery,
  setListingQuery,
  listingStateFilter,
  setListingStateFilter,
  listingSort,
  setListingSort,
  visibleListings,
  listings,
  busy,
  ebayStatus,
  ebayNeedsReconnect,
  ebayNeedsMerchantLocation,
  ebayLocationName,
  setEbayLocationName,
  ebayLocationAddress1,
  setEbayLocationAddress1,
  ebayLocationAddress2,
  setEbayLocationAddress2,
  ebayLocationCity,
  setEbayLocationCity,
  ebayLocationPostcode,
  setEbayLocationPostcode,
  ebayLocationCountry,
  setEbayLocationCountry,
  ebayLocationFormReady,
  ebayLocationCreateAvailable,
  ebayLocationMissingFields,
  ebayLocationMissingRecommendedFields,
  createEbaySellerLocation,
  onAddBuy,
  startListingDesk,
  openSellFromListing,
  listInventoryItem,
  openInventoryEditor,
  openSell,
  addPhotosToInventory,
  addPhotoUrlToInventory,
  moveInventoryPhoto,
  deleteInventoryPhoto,
  copyStockListingCopy,
  copyListingCopy,
  openListingEditor,
  openListingPack,
  pasteListingUrlForListing,
  patchListing,
  setEbayPublishTarget,
  listingPackSheet,
  editListingSheet,
  ebayPublishOverlay,
}: {
  dashboard: Dashboard | null;
  firstDraftListingTarget: Listing | null;
  firstSaleListingTarget: Listing | null;
  unlistedStock: InventoryItem[];
  visibleUnlistedStock: InventoryItem[];
  activeListingCount: number;
  draftListingCount: number;
  listingQuery: string;
  setListingQuery: (value: string) => void;
  listingStateFilter: ListingStateFilter;
  setListingStateFilter: (value: ListingStateFilter) => void;
  listingSort: ListingSort;
  setListingSort: (value: ListingSort) => void;
  visibleListings: Listing[];
  listings: Listing[];
  busy: string | null;
  ebayStatus: EbayStatus | null;
  ebayNeedsReconnect: boolean;
  ebayNeedsMerchantLocation: boolean;
  ebayLocationName: string;
  setEbayLocationName: (value: string) => void;
  ebayLocationAddress1: string;
  setEbayLocationAddress1: (value: string) => void;
  ebayLocationAddress2: string;
  setEbayLocationAddress2: (value: string) => void;
  ebayLocationCity: string;
  setEbayLocationCity: (value: string) => void;
  ebayLocationPostcode: string;
  setEbayLocationPostcode: (value: string) => void;
  ebayLocationCountry: string;
  setEbayLocationCountry: (value: string) => void;
  ebayLocationFormReady: boolean;
  ebayLocationCreateAvailable: boolean;
  ebayLocationMissingFields: string[];
  ebayLocationMissingRecommendedFields: string[];
  createEbaySellerLocation: (event: FormEvent<HTMLFormElement>) => void;
  onAddBuy: () => void;
  startListingDesk: () => void;
  openSellFromListing: (listing: Listing) => void;
  listInventoryItem: (item: InventoryItem) => void;
  openInventoryEditor: (item: InventoryItem) => void;
  openSell: (item: InventoryItem) => void;
  addPhotosToInventory: (item: InventoryItem, files: FileList | File[]) => void;
  addPhotoUrlToInventory: (item: InventoryItem, url: string) => void;
  moveInventoryPhoto: (item: InventoryItem, photoId: string, direction: -1 | 1) => void;
  deleteInventoryPhoto: (item: InventoryItem, photoId: string) => void;
  copyStockListingCopy: (item: InventoryItem, channel: Channel) => void;
  copyListingCopy: (listing: Listing, channel: Channel) => void;
  openListingEditor: (listing: Listing) => void;
  openListingPack: (listing: Listing) => void;
  pasteListingUrlForListing: (listing: Listing) => void;
  patchListing: (listing: Listing, patch: Partial<{ state: Exclude<ListingState, "SOLD"> }>, message: string) => void;
  setEbayPublishTarget: (id: string | null) => void;
  listingPackSheet: ReactNode;
  editListingSheet: ReactNode;
  ebayPublishOverlay: ReactNode;
}) {
  return (
    <section className="workspace listings-workspace">
      <div className="detail-grid">
        <Metric label="Draft" value={String(dashboard?.listingsByState.DRAFT ?? 0)} />
        <Metric label="Active" value={String(dashboard?.listingsByState.ACTIVE ?? 0)} />
        <Metric label="Sold" value={String(dashboard?.listingsByState.SOLD ?? 0)} />
      </div>
      {(firstDraftListingTarget || unlistedStock.length > 0) && (
        <section className="panel listing-desk-panel">
          <div className="panel-heading">
            <div>
              <h2>Listing desk</h2>
              <span className="muted">
                {firstDraftListingTarget
                  ? `${draftListingCount} draft${draftListingCount === 1 ? "" : "s"} ready`
                  : `${unlistedStock.length} unlisted stock row${unlistedStock.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <button className="ghost-button" type="button" onClick={onAddBuy}>
              Add buy
            </button>
          </div>
          {firstDraftListingTarget?.item ? (
            <div className="listing-desk-card">
              <CardImage
                src={inventoryDisplayImage(firstDraftListingTarget.item)}
                className="mini-card-art"
                fallbackClassName="mini-card-art blank"
                alt=""
              />
              <div>
                <span>Next draft</span>
                <strong>{listingQueueLabel(firstDraftListingTarget)}</strong>
                <small>
                  {channelLabel(firstDraftListingTarget.channel)} ·{" "}
                  {gbp(firstDraftListingTarget.listPrice ?? firstDraftListingTarget.suggestedPrice ?? 0)}
                </small>
              </div>
              <button type="button" onClick={startListingDesk}>
                Open pack
              </button>
            </div>
          ) : (
            <div className="listing-desk-card">
              <CardImage
                src={inventoryDisplayImage(unlistedStock[0])}
                className="mini-card-art"
                fallbackClassName="mini-card-art blank"
                alt=""
              />
              <div>
                <span>Next stock</span>
                <strong>{unlistedStock[0]?.card.name ?? "No stock"}</strong>
                <small>
                  {unlistedStock[0]
                    ? `${unlistedStock[0].card.setName} · ${unlistedStock[0].grade.replace(/_/g, " ")}`
                    : "Buy or import stock first"}
                </small>
              </div>
              <button type="button" onClick={startListingDesk} disabled={!unlistedStock[0]}>
                Draft listing
              </button>
            </div>
          )}
        </section>
      )}
      {firstSaleListingTarget?.item && (
        <section className="panel listing-desk-panel sales-desk-panel">
          <div className="panel-heading">
            <div>
              <h2>Sales desk</h2>
              <span className="muted">
                {activeListingCount} active listing{activeListingCount === 1 ? "" : "s"}
              </span>
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setListingStateFilter("ACTIVE");
                setListingSort("newest");
              }}
            >
              Active
            </button>
          </div>
          <div className="listing-desk-card">
            <CardImage
              src={inventoryDisplayImage(firstSaleListingTarget.item)}
              className="mini-card-art"
              fallbackClassName="mini-card-art blank"
              alt=""
            />
            <div>
              <span>Ready to book</span>
              <strong>{listingQueueLabel(firstSaleListingTarget)}</strong>
              <small>
                {channelLabel(firstSaleListingTarget.channel)} ·{" "}
                {gbp(firstSaleListingTarget.listPrice ?? firstSaleListingTarget.suggestedPrice ?? 0)}
              </small>
            </div>
            <button type="button" onClick={() => openSellFromListing(firstSaleListingTarget)}>
              Record sale
            </button>
          </div>
        </section>
      )}
      <div className="export-actions" aria-label="Listing exports">
        <a className="export-link" href="/api/export/listings?state=DRAFT" download>
          Draft CSV
        </a>
        <a className="export-link" href="/api/export/listings" download>
          All listings CSV
        </a>
        <a className="export-link" href="/api/export/listing-pack" download>
          eBay pack CSV
        </a>
      </div>
      <div className="dex-controls listings-controls" aria-label="Listing search and sort">
        <label className="search-control">
          Search
          <input
            value={listingQuery}
            onChange={(event) => setListingQuery(event.target.value)}
            placeholder="Card, channel, grade..."
          />
        </label>
        <label>
          State
          <select
            value={listingStateFilter}
            onChange={(event) => setListingStateFilter(event.target.value as ListingStateFilter)}
          >
            <option value="ALL">all</option>
            <option value="DRAFT">draft</option>
            <option value="ACTIVE">active</option>
            <option value="SOLD">sold</option>
            <option value="ENDED">ended</option>
          </select>
        </label>
        <label>
          Sort
          <select value={listingSort} onChange={(event) => setListingSort(event.target.value as ListingSort)}>
            <option value="newest">newest</option>
            <option value="oldest">oldest</option>
            <option value="highest-price">highest price</option>
            <option value="lowest-price">lowest price</option>
            <option value="channel">channel</option>
            <option value="state">state</option>
          </select>
        </label>
      </div>
      {(listingStateFilter === "ALL" || listingStateFilter === "DRAFT") && unlistedStock.length > 0 && (
        <section className="panel listing-queue-panel">
          <div className="panel-heading">
            <div>
              <h2>Listing queue</h2>
              <span className="muted">{rowCountLabel(visibleUnlistedStock.length, unlistedStock.length)}</span>
            </div>
            <button className="ghost-button" type="button" onClick={onAddBuy}>
              Add buy
            </button>
          </div>
          <div className="listing-queue-list">
            {visibleUnlistedStock.slice(0, 6).map((item) => (
              <ListingQueueRow
                key={item.id}
                item={item}
                busy={busy}
                onDraft={listInventoryItem}
                onEdit={openInventoryEditor}
                onSell={openSell}
                onPhotos={addPhotosToInventory}
                onPhotoUrl={addPhotoUrlToInventory}
                onMovePhoto={moveInventoryPhoto}
                onDeletePhoto={deleteInventoryPhoto}
                onCopy={copyStockListingCopy}
              />
            ))}
          </div>
          {visibleUnlistedStock.length === 0 && <EmptyState text="No unlisted stock matches this search." />}
          {visibleUnlistedStock.length > 6 && (
            <p className="hint">
              Showing 6 of {visibleUnlistedStock.length}. Use search to narrow the queue.
            </p>
          )}
        </section>
      )}
      <div className="section-heading tight">
        <h2>Listings</h2>
        <span>{rowCountLabel(visibleListings.length, listings.length)}</span>
      </div>
      {ebayStatus !== null && !ebayStatus.connected && listings.some((listing) => listing.channel === "EBAY") && (
        <div className="ebay-setup-banner">
          {!ebayStatus.configured ? (
            <span>eBay credentials not configured - set env vars to enable API automation.</span>
          ) : ebayNeedsReconnect ? (
            <>
              <span>eBay connection expired - reconnect your seller account to create offers.</span>
              <a href="/api/ebay/connect">Reconnect eBay</a>
            </>
          ) : (
            <>
              <span>eBay not connected - authorise your seller account to enable offer creation.</span>
              <a href="/api/ebay/connect">Connect eBay</a>
            </>
          )}
        </div>
      )}
      {ebayNeedsMerchantLocation && listings.some((listing) => listing.channel === "EBAY") && (
        <div className="ebay-setup-banner">
          <span>
            eBay is connected and policies are ready. Create your dispatch location once, then offer creation can run from listing packs.
          </span>
          {ebayLocationCreateAvailable ? (
            <form className="ebay-location-form compact" onSubmit={createEbaySellerLocation}>
              <button type="submit" disabled={busy === "ebay-location"}>
                {busy === "ebay-location" ? "Creating location..." : "Create seller location"}
              </button>
              {ebayLocationMissingRecommendedFields.length > 0 && (
                <small>Using default key pdos-main; optional env missing: {ebayLocationMissingRecommendedFields.join(", ")}.</small>
              )}
            </form>
          ) : (
            <form className="ebay-location-form" onSubmit={createEbaySellerLocation}>
              <input
                value={ebayLocationName}
                onChange={(event) => setEbayLocationName(event.target.value)}
                placeholder="Location name"
                autoComplete="organization"
              />
              <input
                value={ebayLocationAddress1}
                onChange={(event) => setEbayLocationAddress1(event.target.value)}
                placeholder="Address line 1"
                autoComplete="address-line1"
              />
              <input
                value={ebayLocationAddress2}
                onChange={(event) => setEbayLocationAddress2(event.target.value)}
                placeholder="Address line 2"
                autoComplete="address-line2"
              />
              <input
                value={ebayLocationCity}
                onChange={(event) => setEbayLocationCity(event.target.value)}
                placeholder="City"
                autoComplete="address-level2"
              />
              <input
                value={ebayLocationPostcode}
                onChange={(event) => setEbayLocationPostcode(event.target.value)}
                placeholder="Postcode"
                autoComplete="postal-code"
              />
              <input
                value={ebayLocationCountry}
                onChange={(event) => setEbayLocationCountry(event.target.value.toUpperCase().slice(0, 2))}
                placeholder="GB"
                autoComplete="country"
                inputMode="text"
              />
              <button type="submit" disabled={busy === "ebay-location" || !ebayLocationFormReady}>
                {busy === "ebay-location" ? "Creating location..." : "Create seller location"}
              </button>
              {ebayLocationMissingFields.length > 0 && (
                <small>Server env missing: {ebayLocationMissingFields.join(", ")}.</small>
              )}
            </form>
          )}
          <a href="https://www.ebay.co.uk/sh/landing" target="_blank" rel="noreferrer">
            Open Seller Hub
          </a>
        </div>
      )}
      {ebayPublishOverlay}
      {visibleListings.map((listing) => (
        <ListingRow
          key={listing.id}
          listing={listing}
          busy={busy}
          ebayConnected={Boolean(ebayStatus?.connected)}
          onEdit={openListingEditor}
          onPack={openListingPack}
          onCopy={copyListingCopy}
          onSell={openSellFromListing}
          onPasteUrl={() => pasteListingUrlForListing(listing)}
          onState={(state) =>
            patchListing(
              listing,
              { state },
              state === "ACTIVE" ? "Listing activated." : "Listing ended.",
            )
          }
          onEbayPublish={() => setEbayPublishTarget(listing.id)}
        />
      ))}
      {listings.length === 0 ? (
        <EmptyState text="No listings yet. Buy can create draft listings automatically." />
      ) : visibleListings.length === 0 ? (
        <EmptyState text="No matching listings. Clear the search or change the state filter." />
      ) : null}
      {editListingSheet}
      {listingPackSheet}
    </section>
  );
}

function ListingQueueRow({
  item,
  busy,
  onDraft,
  onEdit,
  onSell,
  onPhotos,
  onPhotoUrl,
  onMovePhoto,
  onDeletePhoto,
  onCopy,
}: {
  item: InventoryItem;
  busy: string | null;
  onDraft: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
  onSell: (item: InventoryItem) => void;
  onPhotos: (item: InventoryItem, files: FileList | File[]) => void;
  onPhotoUrl: (item: InventoryItem, url: string) => void;
  onMovePhoto: (item: InventoryItem, photoId: string, direction: -1 | 1) => void;
  onDeletePhoto: (item: InventoryItem, photoId: string) => void;
  onCopy: (item: InventoryItem, channel: Channel) => void;
}) {
  const stockNotes = [item.condition, item.graderCert ? `cert ${item.graderCert}` : null, item.location]
    .filter(Boolean)
    .join(" · ");

  const photoCount = item.photos?.length ?? 0;

  return (
    <article className="item-row listing-queue-row">
      <CardImage src={inventoryDisplayImage(item)} className="card-thumb" fallbackClassName="card-thumb blank" alt="" />
      <div className="item-main">
        <div className="item-title-line">
          <h3>{item.card.name}</h3>
          <span className="item-badges">
            <GradeBadge grade={item.grade} />
            <span className={`pill ${statusTone(item.status)}`}>{item.status.replace(/_/g, " ")}</span>
          </span>
        </div>
        <p>
          {item.card.setName} {item.card.number ?? "no number"} · qty {item.quantity} · cost {gbp(item.costBasis)}
        </p>
        {stockNotes && <p>{stockNotes}</p>}
        {photoCount > 0 && <p>{photoCount} real photo{photoCount === 1 ? "" : "s"} ready for eBay</p>}
        <InventoryPhotoTools
          item={item}
          busy={busy}
          onPhotos={(target, files) => onPhotos(target as InventoryItem, files)}
          onPhotoUrl={(target, url) => onPhotoUrl(target as InventoryItem, url)}
          onMovePhoto={(target, photoId, direction) => onMovePhoto(target as InventoryItem, photoId, direction)}
          onDeletePhoto={(target, photoId) => onDeletePhoto(target as InventoryItem, photoId)}
        />
        <div className="row-actions">
          <button
            type="button"
            onClick={() => onDraft(item)}
            disabled={busy?.startsWith("create-listing-") || busy?.startsWith("listing-")}
          >
            Draft + pack
          </button>
          <button type="button" onClick={() => onSell(item)} disabled={busy?.startsWith("sell-")}>
            Sell
          </button>
          <button type="button" onClick={() => onCopy(item, "EBAY")}>
            Copy eBay
          </button>
          <button type="button" onClick={() => onCopy(item, "CARDMARKET")}>
            Copy CM
          </button>
          <button type="button" onClick={() => onCopy(item, "VINTED")}>
            Copy Vinted
          </button>
          <button type="button" onClick={() => onEdit(item)} disabled={busy === `edit-${item.id}`}>
            Edit
          </button>
        </div>
      </div>
    </article>
  );
}

function ListingRow({
  listing,
  busy,
  ebayConnected,
  onEdit,
  onPack,
  onCopy,
  onSell,
  onPasteUrl,
  onState,
  onEbayPublish,
}: {
  listing: Listing;
  busy: string | null;
  ebayConnected: boolean;
  onEdit: (listing: Listing) => void;
  onPack: (listing: Listing) => void;
  onCopy: (listing: Listing, channel: Channel) => void;
  onSell: (listing: Listing) => void;
  onPasteUrl: () => void;
  onState: (state: Exclude<ListingState, "SOLD">) => void;
  onEbayPublish: () => void;
}) {
  const card = listing.item?.card;
  const title = listing.title ?? card?.name ?? "Untitled listing";
  const price = listing.listPrice ?? listing.suggestedPrice ?? 0;
  const economics = listing.item
    ? buildListingEconomics({
        channel: listing.channel,
        grade: listing.item.grade,
        itemPricePence: price,
        costBasisPence: listing.item.costBasis,
      })
    : null;
  const isBusy = busy === `listing-${listing.id}`;
  const isEbayPublishBusy = busy === `ebay-publish-${listing.id}`;
  const canSell = Boolean(listing.item && listing.item.status !== "SOLD" && listing.state !== "SOLD");
  const stockNotes = [
    listing.item?.condition,
    listing.item?.graderCert ? `cert ${listing.item.graderCert}` : null,
  ].filter(Boolean).join(" · ");

  const isEbay = listing.channel === "EBAY";
  const hasOffer = listing.externalRef?.startsWith("offer:");
  const isPublished = listing.externalRef && !listing.externalRef.startsWith("offer:") && listing.externalUrl;
  const canPasteUrl = listing.state !== "SOLD" && !listing.externalUrl;
  const ebayStatusLabel = hasOffer
    ? " · offer pending"
    : isPublished
      ? " · eBay live"
      : listing.externalRef
        ? " · ref saved"
        : "";

  return (
    <article className="item-row">
      <CardImage src={inventoryDisplayImage(listing.item)} className="card-thumb" fallbackClassName="card-thumb blank" alt="" />
      <div className="item-main">
        <div className="item-title-line">
          <h3>{title}</h3>
          <span className="item-badges">
            {listing.item && <GradeBadge grade={listing.item.grade} />}
            <span className={`pill ${listingTone(listing.state)}`}>{listing.state.toLowerCase()}</span>
          </span>
        </div>
        <p>
          {channelLabel(listing.channel)}
          {listing.item?.card.setName ? ` · ${listing.item.card.setName}` : ""}
          {stockNotes ? ` · ${stockNotes}` : ""}
          {ebayStatusLabel}
        </p>
        <p className="listing-row-price">{gbp(price)}</p>
        {economics && (
          <p className={`listing-row-economics ${economics.profitPence >= 0 ? "good" : "warn"}`}>
            Profit {gbp(economics.profitPence)} · net {gbp(economics.netPence)} · {formatPct(economics.roiPct)} ROI
          </p>
        )}
        {listing.state !== "SOLD" && (
          <div className="next-action-strip listing-next-action">
            {isEbay && ebayConnected && hasOffer && !isPublished ? (
              <button className="next-action-button" type="button" onClick={onEbayPublish} disabled={isEbayPublishBusy}>
                {isEbayPublishBusy ? "Publishing..." : "Publish to eBay"}
              </button>
            ) : isEbay && isPublished ? (
              <a className="next-action-button good" href={listing.externalUrl!} target="_blank" rel="noreferrer">
                View live listing
              </a>
            ) : listing.state === "DRAFT" ? (
              <button className="next-action-button" type="button" onClick={() => onPack(listing)} disabled={isBusy}>
                Open listing pack
              </button>
            ) : canSell ? (
              <button className="next-action-button good" type="button" onClick={() => onSell(listing)} disabled={Boolean(busy?.startsWith("sell-"))}>
                Record sale
              </button>
            ) : (
              <button className="next-action-button" type="button" onClick={() => onPack(listing)} disabled={isBusy}>
                Review listing
              </button>
            )}
            <span>
              {listing.state === "DRAFT"
                ? "copy fields, create offer, or activate"
                : hasOffer
                  ? "offer created, publish when ready"
                  : isPublished
                    ? "live on eBay"
                    : listing.state === "ACTIVE"
                      ? "active listing, ready to sell"
                      : listing.state.toLowerCase()}
            </span>
          </div>
        )}
        <div className="row-actions">
          <button type="button" onClick={() => onEdit(listing)} disabled={isBusy || listing.state === "SOLD"}>
            Edit
          </button>
          {listing.item && (
            <button type="button" onClick={() => onPack(listing)} disabled={isBusy}>
              Pack
            </button>
          )}
          {listing.item && listing.state !== "SOLD" && (
            <>
              <button type="button" onClick={() => onCopy(listing, "EBAY")}>
                Copy eBay
              </button>
              <button type="button" onClick={() => onCopy(listing, "CARDMARKET")}>
                Copy CM
              </button>
              <button type="button" onClick={() => onCopy(listing, "VINTED")}>
                Copy Vinted
              </button>
            </>
          )}
          {listing.state !== "ACTIVE" && listing.state !== "SOLD" && !(isEbay && !isPublished) && (
            <button type="button" onClick={() => onState("ACTIVE")} disabled={isBusy}>
              Activate
            </button>
          )}
          {canPasteUrl && (
            <button type="button" onClick={onPasteUrl} disabled={isBusy}>
              Paste URL
            </button>
          )}
          {listing.state === "ACTIVE" && (
            <button type="button" onClick={() => onState("ENDED")} disabled={isBusy}>
              End
            </button>
          )}
          {canSell && (
            <button type="button" onClick={() => onSell(listing)} disabled={Boolean(busy?.startsWith("sell-"))}>
              Sell
            </button>
          )}
          {isEbay && ebayConnected && !isPublished && !hasOffer && listing.state !== "SOLD" && (
            <button
              type="button"
              onClick={() => onPack(listing)}
              disabled={isBusy}
            >
              Prepare eBay
            </button>
          )}
          {isEbay && ebayConnected && hasOffer && !isPublished && (
            <button
              type="button"
              onClick={onEbayPublish}
              disabled={isEbayPublishBusy}
            >
              {isEbayPublishBusy ? "Publishing..." : "Publish"}
            </button>
          )}
          {isEbay && isPublished && (
            <a
              href={listing.externalUrl!}
              target="_blank"
              rel="noreferrer"
            >
              View on eBay
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function GradeBadge({ grade }: { grade: string }) {
  return <span className="grade-badge">{grade.replace(/_/g, " ")}</span>;
}

function rowCountLabel(visible: number, total: number): string {
  return visible === total ? `${total} row${total === 1 ? "" : "s"}` : `${visible}/${total} rows`;
}

function inventoryDisplayImage(item: InventoryItem | undefined | null): string | null {
  return item?.photos?.[0]?.url ?? item?.card.imageUrl ?? null;
}

function statusTone(status: ItemStatus): string {
  if (status === "SOLD") return "good";
  if (status === "LISTED") return "info";
  if (status === "RESERVED") return "warn";
  return "";
}

function listingTone(state: ListingState): string {
  if (state === "SOLD") return "good";
  if (state === "ACTIVE") return "info";
  if (state === "ENDED") return "warn";
  return "";
}

function listingQueueLabel(listing: Listing): string {
  const item = listing.item;
  if (!item) return listing.title ?? "draft";
  return [item.card.name, item.card.number].filter(Boolean).join(" ");
}

function channelLabel(channel: Channel): string {
  if (channel === "EBAY") return "eBay";
  if (channel === "CARDMARKET") return "Cardmarket";
  if (channel === "VINTED") return "Vinted";
  return "In person";
}

function gbp(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`;
}

function formatPct(value: number | null): string {
  return value == null ? "n/a" : `${value.toFixed(1).replace(/\.0$/, "")}%`;
}
