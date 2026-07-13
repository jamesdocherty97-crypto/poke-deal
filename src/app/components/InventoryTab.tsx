"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { InventorySort } from "@/lib/dealer/tableControls";
import { EmptyState, MoneyInput, WorkspaceSkeleton } from "./UiBits";
import { groupInventoryHoldings } from "@/lib/dealer/inventoryGroups";

type InventoryFilter = "needs-action" | "all" | "needs-listing" | "listed" | "needs-photos" | "held" | "sold";
type ItemStatus = "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
type Channel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
type ListingState = "DRAFT" | "ACTIVE" | "SOLD" | "ENDED";

type InventoryFilterOption = {
  value: InventoryFilter;
  label: string;
};

type InventoryItemLike = {
  id: string;
  costBasis: number;
  card: {
    id?: string;
    name: string;
    setName?: string | null;
    number?: string | null;
  };
  grade: string;
  quantity: number;
};

export function InventoryTab({
  visibleInventory,
  filteredInventory,
  activeInventory,
  inventoryFilters,
  inventoryFilter,
  setInventoryFilter,
  inventoryFilterCounts,
  inventoryQuery,
  setInventoryQuery,
  inventorySort,
  setInventorySort,
  busy,
  warmCompsBusy,
  onWarmComps,
  renderInventoryRow,
  emptyInventoryFilterText,
  editingItemId,
  saveInventoryItem,
  closeInventoryEditor,
  itemCost,
  setItemCost,
  itemQuantity,
  setItemQuantity,
  itemSource,
  setItemSource,
  itemLocation,
  setItemLocation,
  itemCondition,
  setItemCondition,
  itemGraderCert,
  setItemGraderCert,
  itemStatus,
  setItemStatus,
  editableStatuses,
  creatingListingItemId,
  creatingListingItem,
  createListing,
  closeCreateListing,
  listingPrice,
  setListingPrice,
  listingChannel,
  setListingChannel,
  channels,
  channelLabel,
  listingState,
  setListingState,
  listingExternalUrl,
  setListingExternalUrl,
  gbp,
  onBulkDraft,
  onBulkMove,
  onBulkExport,
  loading = false,
}: {
  visibleInventory: InventoryItemLike[];
  filteredInventory: InventoryItemLike[];
  activeInventory: InventoryItemLike[];
  inventoryFilters: InventoryFilterOption[];
  inventoryFilter: InventoryFilter;
  setInventoryFilter: (value: InventoryFilter) => void;
  inventoryFilterCounts: Record<InventoryFilter, number>;
  inventoryQuery: string;
  setInventoryQuery: (value: string) => void;
  inventorySort: InventorySort;
  setInventorySort: (value: InventorySort) => void;
  busy: string | null;
  warmCompsBusy?: boolean;
  onWarmComps?: () => void;
  renderInventoryRow: (item: InventoryItemLike) => ReactNode;
  emptyInventoryFilterText: (filter: InventoryFilter) => string;
  editingItemId: string | null;
  saveInventoryItem: (event: FormEvent<HTMLFormElement>) => void;
  closeInventoryEditor: () => void;
  itemCost: string;
  setItemCost: (value: string) => void;
  itemQuantity: string;
  setItemQuantity: (value: string) => void;
  itemSource: string;
  setItemSource: (value: string) => void;
  itemLocation: string;
  setItemLocation: (value: string) => void;
  itemCondition: string;
  setItemCondition: (value: string) => void;
  itemGraderCert: string;
  setItemGraderCert: (value: string) => void;
  itemStatus: ItemStatus;
  setItemStatus: (value: ItemStatus) => void;
  editableStatuses: ItemStatus[];
  creatingListingItemId: string | null;
  creatingListingItem: InventoryItemLike | null;
  createListing: (event: FormEvent<HTMLFormElement>) => void;
  closeCreateListing: () => void;
  listingPrice: string;
  setListingPrice: (value: string) => void;
  listingChannel: Channel;
  setListingChannel: (value: Channel) => void;
  channels: Channel[];
  channelLabel: (channel: Channel) => string;
  listingState: Exclude<ListingState, "SOLD">;
  setListingState: (value: Exclude<ListingState, "SOLD">) => void;
  listingExternalUrl: string;
  setListingExternalUrl: (value: string) => void;
  gbp: (pence: number) => string;
  onBulkDraft: (items: InventoryItemLike[]) => void;
  onBulkMove: (items: InventoryItemLike[], location: string) => void;
  onBulkExport: (items: InventoryItemLike[]) => void;
  loading?: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkLocation, setBulkLocation] = useState("To list");
  const selectedItems = useMemo(
    () => visibleInventory.filter((item) => selectedIds.has(item.id)),
    [selectedIds, visibleInventory],
  );
  const allVisibleSelected = visibleInventory.length > 0 && selectedItems.length === visibleInventory.length;
  const holdings = useMemo(() => groupInventoryHoldings(visibleInventory), [visibleInventory]);

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="workspace inventory-workspace">
      {loading ? <WorkspaceSkeleton label="Loading stock" rows={5} /> : <>
      <div className="section-heading">
        <h2>Inventory</h2>
        <div className="heading-actions">
          {onWarmComps && (
            <button className="ghost-button" type="button" onClick={onWarmComps} disabled={warmCompsBusy || activeInventory.length === 0}>
              {warmCompsBusy ? "Refreshing..." : "Refresh comps"}
            </button>
          )}
          <span>{holdings.length} holding{holdings.length === 1 ? "" : "s"} · {rowCountLabel(visibleInventory.length, filteredInventory.length)}</span>
          <button className="ghost-button" type="button" onClick={() => {
            setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleInventory.map((item) => item.id)));
          }} disabled={visibleInventory.length === 0}>
            {allVisibleSelected ? "Clear" : "Select all"}
          </button>
        </div>
      </div>
      <div className="inventory-filter-tabs" role="group" aria-label="Inventory filters">
        {inventoryFilters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={inventoryFilter === filter.value ? "selected" : ""}
            onClick={() => setInventoryFilter(filter.value)}
            aria-pressed={inventoryFilter === filter.value}
          >
            <span>{filter.label}</span>
            <strong>{inventoryFilterCounts[filter.value]}</strong>
          </button>
        ))}
      </div>
      <div className="dex-controls" aria-label="Inventory search and sort">
        <label className="search-control">
          Search
          <input
            value={inventoryQuery}
            onChange={(event) => setInventoryQuery(event.target.value)}
            placeholder="Name, set, grade..."
          />
        </label>
        <label>
          Sort
          <select value={inventorySort} onChange={(event) => setInventorySort(event.target.value as InventorySort)}>
            <option value="newest">newest</option>
            <option value="oldest">oldest</option>
            <option value="highest-cost">highest cost</option>
            <option value="lowest-cost">lowest cost</option>
            <option value="grade">best grade</option>
            <option value="name">name</option>
          </select>
        </label>
      </div>
      {selectedItems.length > 0 && (
        <div className="bulk-action-bar" aria-label="Bulk stock actions">
          <strong>{selectedItems.length} selected</strong>
          <button type="button" onClick={() => onBulkDraft(selectedItems)} disabled={Boolean(busy)}>Draft listings</button>
          <label>
            <span>Move</span>
            <input value={bulkLocation} onChange={(event) => setBulkLocation(event.target.value)} placeholder="Box / binder" />
          </label>
          <button type="button" onClick={() => onBulkMove(selectedItems, bulkLocation)} disabled={Boolean(busy) || !bulkLocation.trim()}>Apply location</button>
          <button type="button" onClick={() => onBulkExport(selectedItems)}>Export CSV</button>
          <button className="ghost-button" type="button" onClick={() => setSelectedIds(new Set())}>Done</button>
        </div>
      )}
      {holdings.map((holding) => holding.items.length === 1 ? (
        <InventoryLotRow key={holding.key} item={holding.items[0]!} selectedIds={selectedIds} onToggle={toggleSelected} renderInventoryRow={renderInventoryRow} />
      ) : (
        <details className="inventory-holding-group" key={holding.key}>
          <summary>
            <span><strong>{holding.items[0]!.card.name}</strong><small>{holding.items[0]!.grade.replace(/_/g, " ")} · {holding.items.length} cost lots</small></span>
            <span><strong>qty {holding.quantity}</strong><small>avg {gbp(holding.averageUnitCostPence)} each</small></span>
          </summary>
          <div className="inventory-lot-list">
            {holding.items.map((item) => <InventoryLotRow key={item.id} item={item} selectedIds={selectedIds} onToggle={toggleSelected} renderInventoryRow={renderInventoryRow} />)}
          </div>
        </details>
      ))}
      {inventoryFilter === "all" && activeInventory.length === 0 ? (
        <EmptyState text="No active stock. Add your next card from Comp / Buy." />
      ) : filteredInventory.length === 0 ? (
        <EmptyState text={emptyInventoryFilterText(inventoryFilter)} />
      ) : visibleInventory.length === 0 ? (
        <EmptyState text="No matching stock. Clear the search or change the sort." />
      ) : null}

      </>}
      {!loading && editingItemId && (
        <form className="sell-sheet" onSubmit={saveInventoryItem}>
          <div className="panel-heading">
            <h2>Edit stock</h2>
            <button className="ghost-button" type="button" onClick={closeInventoryEditor}>Close</button>
          </div>
          <div className="form-grid">
            <label>
              Cost
              <MoneyInput value={itemCost} onChange={setItemCost} disabled={busy === `edit-${editingItemId}`} />
            </label>
            <label>
              Qty
              <input
                inputMode="numeric"
                value={itemQuantity}
                onChange={(event) => setItemQuantity(event.target.value)}
                disabled={busy === `edit-${editingItemId}`}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Source
              <input
                value={itemSource}
                onChange={(event) => setItemSource(event.target.value)}
                disabled={busy === `edit-${editingItemId}`}
              />
            </label>
            <label>
              Location
              <input
                value={itemLocation}
                onChange={(event) => setItemLocation(event.target.value)}
                disabled={busy === `edit-${editingItemId}`}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Condition
              <input
                value={itemCondition}
                onChange={(event) => setItemCondition(event.target.value)}
                placeholder="NM, LP, light edgewear..."
                disabled={busy === `edit-${editingItemId}`}
              />
            </label>
            <label>
              Cert
              <input
                inputMode="numeric"
                value={itemGraderCert}
                onChange={(event) => setItemGraderCert(event.target.value)}
                placeholder="PSA/BGS/CGC cert"
                disabled={busy === `edit-${editingItemId}`}
              />
            </label>
          </div>
          <label>
            Status
            <select
              value={itemStatus}
              onChange={(event) => setItemStatus(event.target.value as ItemStatus)}
              disabled={busy === `edit-${editingItemId}`}
            >
              {editableStatuses.map((status) => (
                <option key={status} value={status}>{status.replace(/_/g, " ").toLowerCase()}</option>
              ))}
            </select>
          </label>
          <button className="primary-action" type="submit" disabled={busy === `edit-${editingItemId}`}>
            {busy === `edit-${editingItemId}` ? "Saving..." : "Save stock"}
          </button>
        </form>
      )}

      {creatingListingItemId && creatingListingItem && (
        <form className="sell-sheet" onSubmit={createListing}>
          <div className="panel-heading">
            <div>
              <h2>Create listing</h2>
              <span className="muted">{creatingListingItem.card.name} · cost {gbp(creatingListingItem.costBasis)}</span>
            </div>
            <button className="ghost-button" type="button" onClick={closeCreateListing}>Close</button>
          </div>
          <div className="form-grid">
            <label>
              List price
              <MoneyInput value={listingPrice} onChange={setListingPrice} />
            </label>
            <label>
              Channel
              <select value={listingChannel} onChange={(event) => setListingChannel(event.target.value as Channel)}>
                {channels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
              </select>
            </label>
          </div>
          <label>
            State
            <select value={listingState} onChange={(event) => setListingState(event.target.value as Exclude<ListingState, "SOLD">)}>
              <option value="DRAFT">draft</option>
              <option value="ACTIVE">active</option>
            </select>
          </label>
          <label>
            Listing URL
            <input value={listingExternalUrl} onChange={(event) => setListingExternalUrl(event.target.value)} placeholder="https://..." />
          </label>
          <button className="primary-action" type="submit" disabled={busy === `create-listing-${creatingListingItemId}`}>
            {busy === `create-listing-${creatingListingItemId}` ? "Saving..." : "Create listing"}
          </button>
        </form>
      )}
    </section>
  );
}

function InventoryLotRow({ item, selectedIds, onToggle, renderInventoryRow }: {
  item: InventoryItemLike;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  renderInventoryRow: (item: InventoryItemLike) => ReactNode;
}) {
  return (
    <div className={`bulk-select-row${selectedIds.has(item.id) ? " selected" : ""}`}>
      <label className="bulk-row-checkbox">
        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => onToggle(item.id)} />
        <span>Select {item.card.name}</span>
      </label>
      {renderInventoryRow(item)}
    </div>
  );
}

function rowCountLabel(visible: number, total: number): string {
  return visible === total ? `${total} row${total === 1 ? "" : "s"}` : `${visible}/${total} rows`;
}
