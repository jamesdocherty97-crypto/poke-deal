"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type View = "acquire" | "inventory" | "listings" | "pnl";
type Grade = "RAW" | "PSA_9" | "PSA_10" | "BGS_9_5" | "CGC_10";
type Channel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
type ItemStatus = "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
type ListingState = "DRAFT" | "ACTIVE" | "SOLD" | "ENDED";

type CompResult = {
  source: string;
  grade: string;
  medianPence: number;
  meanPence: number;
  lowPence: number;
  highPence: number;
  sampleSize: number;
  windowDays: number;
  trendPct: number | null;
  outliersRemoved: number;
  asOf: string;
  raw?: {
    smartMarketPrice?: { confidence?: string; daysUsed?: number; method?: string };
    chosenPriceSource?: string;
  };
};

type Reconciled = { headline: CompResult; all: CompResult[]; sourcesDisagree: boolean };
type Suggestion = {
  pricePence: number;
  strategy: string;
  confidence: "high" | "low" | "none";
  flooredToMargin: boolean;
  rationale: string;
};

type InventoryItem = {
  id: string;
  card: {
    name: string;
    setName: string;
    number: string | null;
    imageUrl: string | null;
  };
  grade: string;
  quantity: number;
  costBasis: number;
  acquiredFrom: string | null;
  location: string | null;
  status: ItemStatus;
  createdAt: string;
  listings: Listing[];
  sales: Sale[];
};

type Listing = {
  id: string;
  channel: Channel;
  state: ListingState;
  title: string | null;
  externalUrl: string | null;
  suggestedPrice: number | null;
  listPrice: number | null;
  createdAt: string;
  listedAt: string | null;
  endedAt: string | null;
  item?: InventoryItem;
};

type Sale = {
  id: string;
  channel: Channel;
  salePrice: number;
  fees: number;
  postage: number;
  soldAt: string;
};

type Dashboard = {
  metrics: {
    stockCount: number;
    listedCount: number;
    soldCount: number;
    reservedCount: number;
    activeCostPence: number;
    realizedRevenuePence: number;
    realizedProfitPence: number;
    realizedMarginPct: number | null;
    sellThroughPct: number;
    averageAgeDays: number;
    agedStockCount: number;
    bestSale: SaleSummary | null;
    worstSale: SaleSummary | null;
  };
  recentSales: SaleSummary[];
  staleStock: Array<{ id: string; name: string; grade: string; status: ItemStatus; createdAt: string }>;
  listingsByState: Record<string, number>;
};

type SaleSummary = {
  id: string;
  itemId: string;
  name: string;
  grade: string;
  profitPence: number;
  marginPct: number | null;
  soldAt: string;
};

const grades: Grade[] = ["RAW", "PSA_9", "PSA_10", "BGS_9_5", "CGC_10"];
const channels: Channel[] = ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"];

export default function Home() {
  const [view, setView] = useState<View>("acquire");
  const [name, setName] = useState("Charizard ex");
  const [setNameValue, setSetNameValue] = useState("151");
  const [number, setNumber] = useState("199/165");
  const [grade, setGrade] = useState<Grade>("RAW");
  const [cost, setCost] = useState("18.00");
  const [source, setSource] = useState("Card fair");
  const [location, setLocation] = useState("Box A");
  const [strategy, setStrategy] = useState("market");
  const [channel, setChannel] = useState<Channel>("EBAY");
  const [comp, setComp] = useState<Reconciled | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [salePrice, setSalePrice] = useState("");
  const [fees, setFees] = useState("");
  const [postage, setPostage] = useState("1.20");
  const [saleChannel, setSaleChannel] = useState<Channel>("EBAY");
  const [repriceMessage, setRepriceMessage] = useState<string | null>(null);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [listingPrice, setListingPrice] = useState("");
  const [listingState, setListingState] = useState<Exclude<ListingState, "SOLD">>("DRAFT");
  const [listingChannel, setListingChannel] = useState<Channel>("EBAY");
  const [listingExternalUrl, setListingExternalUrl] = useState("");

  useEffect(() => {
    void refreshAll();
  }, []);

  const activeInventory = useMemo(
    () => inventory.filter((item) => item.status !== "SOLD"),
    [inventory],
  );
  const soldInventory = useMemo(
    () => inventory.filter((item) => item.status === "SOLD"),
    [inventory],
  );
  const headline = comp?.headline ?? null;
  const confidenceLabel = headline ? compConfidence(headline, comp?.sourcesDisagree ?? false) : null;

  async function refreshAll() {
    setError(null);
    try {
      const [inventoryRes, listingsRes, dashboardRes] = await Promise.all([
        fetch("/api/inventory"),
        fetch("/api/listings"),
        fetch("/api/dashboard"),
      ]);
      const inventoryJson = await readJson(inventoryRes);
      const listingsJson = await readJson(listingsRes);
      const dashboardJson = await readJson(dashboardRes);
      if (!inventoryRes.ok) throw new Error(inventoryJson.error ?? "inventory failed");
      if (!listingsRes.ok) throw new Error(listingsJson.error ?? "listings failed");
      if (!dashboardRes.ok) throw new Error(dashboardJson.error ?? "dashboard failed");
      setInventory(inventoryJson.items);
      setListings(listingsJson.listings);
      setDashboard(dashboardJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : "refresh failed");
    }
  }

  async function lookup(event?: FormEvent) {
    event?.preventDefault();
    setBusy("lookup");
    setError(null);
    setNotice(null);
    setSuggestion(null);
    try {
      const qs = new URLSearchParams({
        name,
        set: setNameValue,
        number,
        grade,
      });
      const res = await fetch(`/api/comps?${qs}`);
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "lookup failed");
      setComp(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "lookup failed");
    } finally {
      setBusy(null);
    }
  }

  async function acquire(event: FormEvent) {
    event.preventDefault();
    setBusy("acquire");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/inventory/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card: { name, setName: setNameValue, number },
          grade,
          costBasisPence: poundsToPence(cost),
          acquiredFrom: source || undefined,
          location: location || undefined,
          strategy,
          channel,
          createListing: true,
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "acquire failed");
      setSuggestion(payload.suggestion);
      setComp({ headline: payload.comp, all: [payload.comp], sourcesDisagree: false });
      setNotice(`Stocked. List at ${gbp(payload.suggestion.pricePence)}.`);
      await refreshAll();
      setView("inventory");
    } catch (err) {
      setError(err instanceof Error ? err.message : "acquire failed");
    } finally {
      setBusy(null);
    }
  }

  function openSell(item: InventoryItem) {
    const price = item.listings[0]?.listPrice ?? item.listings[0]?.suggestedPrice ?? item.costBasis;
    setSellingId(item.id);
    setSalePrice(penceToPounds(price));
    setFees(penceToPounds(Math.round(price * 0.128) + 30));
    setPostage("1.20");
    setSaleChannel(item.listings[0]?.channel ?? "EBAY");
  }

  async function markSold(event: FormEvent) {
    event.preventDefault();
    if (!sellingId) return;
    setBusy(`sell-${sellingId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/inventory/${sellingId}/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: saleChannel,
          salePricePence: poundsToPence(salePrice),
          feesPence: poundsToPence(fees),
          postagePence: poundsToPence(postage),
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "mark sold failed");
      setNotice(`Sold. Profit ${gbp(payload.profitPence)}.`);
      setSellingId(null);
      await refreshAll();
      setView("pnl");
    } catch (err) {
      setError(err instanceof Error ? err.message : "mark sold failed");
    } finally {
      setBusy(null);
    }
  }

  async function updateStatus(item: InventoryItem, status: ItemStatus) {
    setBusy(`status-${item.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "update failed");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteItem(item: InventoryItem) {
    const ok = window.confirm(`Delete ${item.card.name} ${item.grade}?`);
    if (!ok) return;
    setBusy(`delete-${item.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/${item.id}`, { method: "DELETE" });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "delete failed");
      setNotice("Inventory row deleted.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(null);
    }
  }

  function openListingEditor(listing: Listing) {
    setEditingListingId(listing.id);
    setListingPrice(penceToPounds(listing.listPrice ?? listing.suggestedPrice ?? 0));
    setListingState(listing.state === "SOLD" ? "ENDED" : listing.state);
    setListingChannel(listing.channel);
    setListingExternalUrl(listing.externalUrl ?? "");
  }

  async function patchListing(
    listing: Listing,
    patch: Partial<{
      channel: Channel;
      state: Exclude<ListingState, "SOLD">;
      listPricePence: number | null;
      externalUrl: string | null;
    }>,
    message = "Listing updated.",
  ) {
    setBusy(`listing-${listing.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/listings/${listing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "listing update failed");
      setNotice(message);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "listing update failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveListing(event: FormEvent) {
    event.preventDefault();
    const listing = listings.find((row) => row.id === editingListingId);
    if (!listing) return;
    await patchListing(
      listing,
      {
        channel: listingChannel,
        state: listingState,
        listPricePence: poundsToPence(listingPrice),
        externalUrl: listingExternalUrl.trim() || null,
      },
      "Listing saved.",
    );
    setEditingListingId(null);
  }

  async function checkReprices() {
    setBusy("reprice");
    setError(null);
    setRepriceMessage(null);
    try {
      const res = await fetch("/api/alerts/reprice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify: true, limit: 10, thresholdPct: 10 }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "reprice check failed");
      const count = payload.recommendations?.length ?? 0;
      setRepriceMessage(
        count === 0
          ? "No repricing alerts right now."
          : `${count} repricing alert${count === 1 ? "" : "s"} found${payload.notified ? " and sent" : ""}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "reprice check failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Pokemon Dealer OS</p>
          <h1>{viewTitle(view)}</h1>
        </div>
        <button className="icon-button" type="button" onClick={refreshAll} aria-label="Refresh data">
          R
        </button>
      </header>

      <section className="status-strip" aria-label="Business summary">
        <Metric label="Stock" value={String(dashboard?.metrics.stockCount ?? activeInventory.length)} />
        <Metric label="Listed" value={String(dashboard?.metrics.listedCount ?? 0)} />
        <Metric label="Profit" value={gbp(dashboard?.metrics.realizedProfitPence ?? 0)} tone="good" />
      </section>

      {notice && <div className="notice success">{notice}</div>}
      {error && <div className="notice danger">{error}</div>}

      {view === "acquire" && (
        <section className="workspace">
          <form className="panel lookup-panel" onSubmit={lookup}>
            <div className="panel-heading">
              <h2>Fast comp</h2>
              <span className="muted">Live GBP valuation</span>
            </div>
            <label>
              Card
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Card name" />
            </label>
            <div className="form-grid">
              <label>
                Set
                <input value={setNameValue} onChange={(event) => setSetNameValue(event.target.value)} placeholder="151" />
              </label>
              <label>
                Number
                <input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="199/165" />
              </label>
            </div>
            <div className="segmented" role="group" aria-label="Grade">
              {grades.map((g) => (
                <button
                  key={g}
                  className={grade === g ? "selected" : ""}
                  type="button"
                  onClick={() => setGrade(g)}
                >
                  {g.replace(/_/g, " ")}
                </button>
              ))}
            </div>
            <button className="primary-action" type="submit" disabled={busy === "lookup"}>
              {busy === "lookup" ? "Looking up..." : "Look up comp"}
            </button>
          </form>

          {headline && (
            <section className="panel">
              <div className="comp-hero">
                <div>
                  <p className="eyebrow">{headline.source}</p>
                  <h2>{gbp(headline.medianPence)}</h2>
                </div>
                <span className={`pill ${confidenceLabel?.tone ?? ""}`}>{confidenceLabel?.label}</span>
              </div>
              <div className="detail-grid">
                <Metric label="Range" value={`${gbp(headline.lowPence)}-${gbp(headline.highPence)}`} />
                <Metric label="Sample" value={`${headline.sampleSize} / ${headline.windowDays}d`} />
                <Metric label="Outliers" value={String(headline.outliersRemoved)} />
              </div>
              {headline.raw?.chosenPriceSource === "smartMarketPrice" && (
                <p className="hint">
                  RAW is using the provider smart price to reduce noisy ungraded eBay leakage.
                  {headline.raw.smartMarketPrice?.confidence
                    ? ` Confidence: ${headline.raw.smartMarketPrice.confidence}.`
                    : ""}
                </p>
              )}
              {comp?.sourcesDisagree && (
                <p className="hint danger-text">Sources disagree materially. Treat this as a check-before-buy price.</p>
              )}
            </section>
          )}

          <form className="panel" onSubmit={acquire}>
            <div className="panel-heading">
              <h2>Just bought it</h2>
              <span className="muted">Stock + draft listing</span>
            </div>
            <div className="form-grid">
              <label>
                Cost GBP
                <input inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} />
              </label>
              <label>
                Strategy
                <select value={strategy} onChange={(event) => setStrategy(event.target.value)}>
                  <option value="quick">Quick</option>
                  <option value="market">Market</option>
                  <option value="patient">Patient</option>
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                Source
                <input value={source} onChange={(event) => setSource(event.target.value)} />
              </label>
              <label>
                Location
                <input value={location} onChange={(event) => setLocation(event.target.value)} />
              </label>
            </div>
            <label>
              Channel
              <select value={channel} onChange={(event) => setChannel(event.target.value as Channel)}>
                {channels.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
              </select>
            </label>
            <button className="primary-action" type="submit" disabled={busy === "acquire"}>
              {busy === "acquire" ? "Stocking..." : "Acquire + price"}
            </button>
            {suggestion && (
              <p className="hint">
                Suggested list price {gbp(suggestion.pricePence)}. {suggestion.rationale}
              </p>
            )}
          </form>
        </section>
      )}

      {view === "inventory" && (
        <section className="workspace">
          <div className="section-heading">
            <h2>Active stock</h2>
            <span>{activeInventory.length} rows</span>
          </div>
          {activeInventory.map((item) => (
            <InventoryRow
              key={item.id}
              item={item}
              busy={busy}
              onSell={openSell}
              onStatus={updateStatus}
              onDelete={deleteItem}
            />
          ))}
          {activeInventory.length === 0 && <EmptyState text="No active stock. Acquire your next buy from the first tab." />}

          {sellingId && (
            <form className="sell-sheet" onSubmit={markSold}>
              <div className="panel-heading">
                <h2>Mark sold</h2>
                <button className="ghost-button" type="button" onClick={() => setSellingId(null)}>Close</button>
              </div>
              <div className="form-grid">
                <label>
                  Sale GBP
                  <input inputMode="decimal" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} />
                </label>
                <label>
                  Fees GBP
                  <input inputMode="decimal" value={fees} onChange={(event) => setFees(event.target.value)} />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Postage GBP
                  <input inputMode="decimal" value={postage} onChange={(event) => setPostage(event.target.value)} />
                </label>
                <label>
                  Channel
                  <select value={saleChannel} onChange={(event) => setSaleChannel(event.target.value as Channel)}>
                    {channels.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
                  </select>
                </label>
              </div>
              <button className="primary-action" type="submit" disabled={busy === `sell-${sellingId}`}>
                {busy === `sell-${sellingId}` ? "Saving..." : "Create sale"}
              </button>
            </form>
          )}

          {soldInventory.length > 0 && (
            <>
              <div className="section-heading">
                <h2>Sold</h2>
                <span>{soldInventory.length} rows</span>
              </div>
              {soldInventory.slice(0, 8).map((item) => (
                <InventoryRow
                  key={item.id}
                  item={item}
                  busy={busy}
                  onSell={openSell}
                  onStatus={updateStatus}
                  onDelete={deleteItem}
                />
              ))}
            </>
          )}
        </section>
      )}

      {view === "listings" && (
        <section className="workspace">
          <div className="detail-grid">
            <Metric label="Draft" value={String(dashboard?.listingsByState.DRAFT ?? 0)} />
            <Metric label="Active" value={String(dashboard?.listingsByState.ACTIVE ?? 0)} />
            <Metric label="Sold" value={String(dashboard?.listingsByState.SOLD ?? 0)} />
          </div>
          {listings.map((listing) => (
            <ListingRow
              key={listing.id}
              listing={listing}
              busy={busy}
              onEdit={openListingEditor}
              onState={(state) =>
                patchListing(
                  listing,
                  { state },
                  state === "ACTIVE" ? "Listing activated." : "Listing ended.",
                )
              }
            />
          ))}
          {listings.length === 0 && <EmptyState text="No listings yet. Acquire can create draft listings automatically." />}
          {editingListingId && (
            <form className="sell-sheet" onSubmit={saveListing}>
              <div className="panel-heading">
                <h2>Edit listing</h2>
                <button className="ghost-button" type="button" onClick={() => setEditingListingId(null)}>Close</button>
              </div>
              <div className="form-grid">
                <label>
                  List GBP
                  <input inputMode="decimal" value={listingPrice} onChange={(event) => setListingPrice(event.target.value)} />
                </label>
                <label>
                  Channel
                  <select value={listingChannel} onChange={(event) => setListingChannel(event.target.value as Channel)}>
                    {channels.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
                  </select>
                </label>
              </div>
              <label>
                State
                <select value={listingState} onChange={(event) => setListingState(event.target.value as Exclude<ListingState, "SOLD">)}>
                  <option value="DRAFT">draft</option>
                  <option value="ACTIVE">active</option>
                  <option value="ENDED">ended</option>
                </select>
              </label>
              <label>
                Listing URL
                <input value={listingExternalUrl} onChange={(event) => setListingExternalUrl(event.target.value)} placeholder="https://..." />
              </label>
              <button className="primary-action" type="submit" disabled={busy === `listing-${editingListingId}`}>
                {busy === `listing-${editingListingId}` ? "Saving..." : "Save listing"}
              </button>
            </form>
          )}
        </section>
      )}

      {view === "pnl" && (
        <section className="workspace">
          <div className="detail-grid">
            <Metric label="Revenue" value={gbp(dashboard?.metrics.realizedRevenuePence ?? 0)} />
            <Metric label="Profit" value={gbp(dashboard?.metrics.realizedProfitPence ?? 0)} tone="good" />
            <Metric
              label="Margin"
              value={dashboard?.metrics.realizedMarginPct == null ? "n/a" : `${dashboard.metrics.realizedMarginPct}%`}
            />
            <Metric label="Sell-through" value={`${dashboard?.metrics.sellThroughPct ?? 0}%`} />
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>Stock health</h2>
              <span className="muted">{dashboard?.metrics.averageAgeDays ?? 0}d avg age</span>
            </div>
            <div className="detail-grid">
              <Metric label="Active cost" value={gbp(dashboard?.metrics.activeCostPence ?? 0)} />
              <Metric label="45d+ stock" value={String(dashboard?.metrics.agedStockCount ?? 0)} />
            </div>
            <button className="primary-action" type="button" onClick={checkReprices} disabled={busy === "reprice"}>
              {busy === "reprice" ? "Checking..." : "Check + alert Discord"}
            </button>
            {repriceMessage && <p className="hint">{repriceMessage}</p>}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Recent sales</h2>
              <span className="muted">Booked profit</span>
            </div>
            {dashboard?.recentSales.length ? (
              dashboard.recentSales.map((sale) => (
                <article className="mini-row" key={sale.id}>
                  <span>{sale.name} {sale.grade.replace(/_/g, " ")}</span>
                  <strong>{gbp(sale.profitPence)}</strong>
                </article>
              ))
            ) : (
              <EmptyState text="No sales booked yet. Mark an item sold from Inventory." />
            )}
          </section>
        </section>
      )}

      <nav className="bottom-nav" aria-label="Primary">
        <TabButton active={view === "acquire"} label="Acquire" onClick={() => setView("acquire")} />
        <TabButton active={view === "inventory"} label="Stock" onClick={() => setView("inventory")} />
        <TabButton active={view === "listings"} label="Listings" onClick={() => setView("listings")} />
        <TabButton active={view === "pnl"} label="P&L" onClick={() => setView("pnl")} />
      </nav>
    </main>
  );
}

function InventoryRow({
  item,
  busy,
  onSell,
  onStatus,
  onDelete,
}: {
  item: InventoryItem;
  busy: string | null;
  onSell: (item: InventoryItem) => void;
  onStatus: (item: InventoryItem, status: ItemStatus) => void;
  onDelete: (item: InventoryItem) => void;
}) {
  const listing = item.listings[0];
  const sale = item.sales[0];
  return (
    <article className="item-row">
      {item.card.imageUrl ? <img src={item.card.imageUrl} alt="" className="card-thumb" /> : <div className="card-thumb blank" />}
      <div className="item-main">
        <div className="item-title-line">
          <h3>{item.card.name}</h3>
          <span className={`pill ${statusTone(item.status)}`}>{item.status.replace(/_/g, " ")}</span>
        </div>
        <p>
          {item.card.number ?? "no number"} · {item.grade.replace(/_/g, " ")} · cost {gbp(item.costBasis)}
        </p>
        <p>
          {listing ? `Draft ${channelLabel(listing.channel)} at ${gbp(listing.listPrice ?? listing.suggestedPrice ?? 0)}` : "No listing"}
          {sale ? ` · sold ${gbp(sale.salePrice)}` : ""}
        </p>
        <div className="row-actions">
          {item.status !== "SOLD" && (
            <button type="button" onClick={() => onSell(item)} disabled={busy?.startsWith("sell-")}>
              Sell
            </button>
          )}
          {item.status === "IN_STOCK" && (
            <button type="button" onClick={() => onStatus(item, "LISTED")} disabled={busy === `status-${item.id}`}>
              List
            </button>
          )}
          {item.status !== "RESERVED" && item.status !== "SOLD" && (
            <button type="button" onClick={() => onStatus(item, "RESERVED")} disabled={busy === `status-${item.id}`}>
              Hold
            </button>
          )}
          <button className="danger-button" type="button" onClick={() => onDelete(item)} disabled={busy === `delete-${item.id}`}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function ListingRow({
  listing,
  busy,
  onEdit,
  onState,
}: {
  listing: Listing;
  busy: string | null;
  onEdit: (listing: Listing) => void;
  onState: (state: Exclude<ListingState, "SOLD">) => void;
}) {
  const card = listing.item?.card;
  const title = listing.title ?? card?.name ?? "Untitled listing";
  const price = listing.listPrice ?? listing.suggestedPrice ?? 0;
  const isBusy = busy === `listing-${listing.id}`;

  return (
    <article className="item-row">
      {card?.imageUrl ? <img src={card.imageUrl} alt="" className="card-thumb" /> : <div className="card-thumb blank" />}
      <div className="item-main">
        <div className="item-title-line">
          <h3>{title}</h3>
          <span className={`pill ${listingTone(listing.state)}`}>{listing.state.toLowerCase()}</span>
        </div>
        <p>
          {channelLabel(listing.channel)}
          {listing.item ? ` · ${listing.item.grade.replace(/_/g, " ")}` : ""}
          {listing.externalUrl ? " · URL saved" : ""}
        </p>
        <p>{gbp(price)}</p>
        <div className="row-actions">
          <button type="button" onClick={() => onEdit(listing)} disabled={isBusy || listing.state === "SOLD"}>
            Edit
          </button>
          {listing.state !== "ACTIVE" && listing.state !== "SOLD" && (
            <button type="button" onClick={() => onState("ACTIVE")} disabled={isBusy}>
              Activate
            </button>
          )}
          {listing.state === "ACTIVE" && (
            <button type="button" onClick={() => onState("ENDED")} disabled={isBusy}>
              End
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}

function compConfidence(comp: CompResult, sourcesDisagree: boolean): { label: string; tone: string } {
  if (comp.sampleSize === 0) return { label: "No comps", tone: "danger" };
  if (sourcesDisagree) return { label: "Cross-check", tone: "warn" };
  if (comp.sampleSize < 3) return { label: "Thin", tone: "warn" };
  return { label: "Usable", tone: "good" };
}

function statusTone(status: ItemStatus): string {
  if (status === "SOLD") return "good";
  if (status === "RESERVED") return "warn";
  if (status === "LISTED") return "info";
  return "";
}

function listingTone(state: ListingState): string {
  if (state === "SOLD") return "good";
  if (state === "ACTIVE") return "info";
  if (state === "ENDED") return "warn";
  return "";
}

function viewTitle(view: View): string {
  if (view === "acquire") return "Buy well, price fast";
  if (view === "inventory") return "Inventory";
  if (view === "listings") return "Listings";
  return "Profit and loss";
}

function channelLabel(channel: Channel): string {
  return channel.replace("_", "-").toLowerCase();
}

function gbp(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`;
}

function poundsToPence(value: string): number {
  const normalized = value.replace(/[^0-9.-]/g, "");
  const pounds = Number(normalized);
  return Number.isFinite(pounds) ? Math.round(pounds * 100) : 0;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const path = new URL(response.url).pathname;
    throw new Error(`${path} returned ${response.status}. Retrying usually fixes this after a dev refresh.`);
  }
}
