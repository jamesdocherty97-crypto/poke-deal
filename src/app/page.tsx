"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  buildInventoryView,
  buildListingView,
  type InventorySort,
  type ListingSort,
  type ListingStateFilter,
} from "@/lib/dealer/tableControls";

type View = "acquire" | "inventory" | "listings" | "pnl";
type Grade = "RAW" | "PSA_9" | "PSA_10" | "BGS_9_5" | "CGC_10";
type Channel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
type ItemStatus = "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
type ListingState = "DRAFT" | "ACTIVE" | "SOLD" | "ENDED";

type CatalogCard = {
  name: string;
  setName: string;
  number?: string;
  rarity?: string;
  imageUrl?: string;
  setLogoUrl?: string;
  setSymbolUrl?: string;
  tcgApiId?: string;
  priceSignals?: CatalogPriceSignal[];
};

type CatalogPriceSignal = {
  source: "tcgplayer" | "cardmarket";
  label: string;
  pricePence: number;
  originalAmount: number;
  originalCurrency: "USD" | "EUR";
  kind: string;
  variant?: string;
  updatedAt?: string;
  url?: string;
};

type OwnedSaleCompRow = {
  id: string;
  itemId: string;
  salePricePence: number;
  feesPence: number;
  postagePence: number;
  costBasisPence: number;
  soldAt: string;
};

// Bundled offline set catalog (see src/lib/catalog/setCatalog.ts) -- powers
// set autocomplete and the "popular sets" quick-pick chips below.
type CatalogSet = {
  id: string;
  name: string;
  ptcgoCode?: string;
  symbolUrl?: string;
  logoUrl?: string;
};

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
    kind?: string;
    caveat?: string;
    chosenSignal?: CatalogPriceSignal;
    sales?: OwnedSaleCompRow[];
  };
};

type Reconciled = {
  headline: CompResult;
  all: CompResult[];
  sourcesDisagree: boolean;
  catalog?: CatalogCard | null;
};
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

type RepriceRecommendation = {
  itemId: string;
  cardName: string;
  grade: string;
  currentPricePence: number;
  suggestedPricePence: number;
  movePct: number;
  confidence: "high" | "low" | "none";
  reason: string;
};

type WatchRecord = {
  id: string;
  grade: string;
  targetPence: number;
  active: boolean;
  createdAt: string;
  card: {
    name: string;
    setName: string;
    number: string | null;
    imageUrl: string | null;
  };
  alerts?: Array<{ id: string; message: string; pence: number | null; firedAt: string; delivered: boolean }>;
};

type WatchHit = {
  watchId: string;
  cardName: string;
  grade: string;
  targetPence: number;
  marketPence: number;
  sampleSize: number;
  windowDays: number;
  message: string;
};

type PortfolioPoint = {
  date: string;
  marketValuePence: number;
  snapshotCount: number;
};

type PortfolioHistory = {
  points: PortfolioPoint[];
  latest: PortfolioPoint | null;
  previous: PortfolioPoint | null;
  changePence: number | null;
  changePct: number | null;
  written?: number;
  skipped?: number;
  scannedCount?: number;
  checkedAt?: string;
};

const grades: Grade[] = ["RAW", "PSA_9", "PSA_10", "BGS_9_5", "CGC_10"];
const channels: Channel[] = ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"];
const quickHunts = [
  {
    name: "Charizard ex",
    setName: "151",
    number: "199/165",
    imageUrl: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
  },
  {
    name: "Pikachu ex",
    setName: "Surging Sparks",
    number: "238/191",
    imageUrl: "https://images.pokemontcg.io/sv8/238_hires.png",
  },
  {
    name: "Mew ex",
    setName: "Paldean Fates",
    number: "232/091",
    imageUrl: "https://images.pokemontcg.io/sv4pt5/232_hires.png",
  },
  {
    name: "Umbreon VMAX",
    setName: "Evolving Skies",
    number: "215/203",
    imageUrl: "https://images.pokemontcg.io/swsh7/215_hires.png",
  },
];

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
  const [portfolio, setPortfolio] = useState<PortfolioHistory | null>(null);
  const [watches, setWatches] = useState<WatchRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [salePrice, setSalePrice] = useState("");
  const [fees, setFees] = useState("");
  const [postage, setPostage] = useState("1.20");
  const [saleChannel, setSaleChannel] = useState<Channel>("EBAY");
  const [repriceMessage, setRepriceMessage] = useState<string | null>(null);
  const [repriceRecommendations, setRepriceRecommendations] = useState<RepriceRecommendation[]>([]);
  const [repriceCheckedAt, setRepriceCheckedAt] = useState<string | null>(null);
  const [discordReady, setDiscordReady] = useState<boolean | null>(null);
  const [watchTarget, setWatchTarget] = useState("15.00");
  const [watchEdits, setWatchEdits] = useState<Record<string, string>>({});
  const [watchHits, setWatchHits] = useState<WatchHit[]>([]);
  const [watchMessage, setWatchMessage] = useState<string | null>(null);
  const [watchCheckedAt, setWatchCheckedAt] = useState<string | null>(null);
  const [watchDiscordReady, setWatchDiscordReady] = useState<boolean | null>(null);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [listingPrice, setListingPrice] = useState("");
  const [listingState, setListingState] = useState<Exclude<ListingState, "SOLD">>("DRAFT");
  const [listingChannel, setListingChannel] = useState<Channel>("EBAY");
  const [listingExternalUrl, setListingExternalUrl] = useState("");
  const [cardArtUrl, setCardArtUrl] = useState<string | null>(null);
  const [gradeComp, setGradeComp] = useState<CompResult | null>(null);
  const [gradeOdds, setGradeOdds] = useState("45");
  const [gradingCost, setGradingCost] = useState("19.99");
  const [popularSets, setPopularSets] = useState<CatalogSet[]>([]);
  const [setSuggestions, setSetSuggestions] = useState<CatalogSet[]>([]);
  const [setSuggestionsOpen, setSetSuggestionsOpen] = useState(false);
  const [cardSuggestions, setCardSuggestions] = useState<CatalogCard[]>([]);
  const [cardSuggestionsOpen, setCardSuggestionsOpen] = useState(false);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventorySort, setInventorySort] = useState<InventorySort>("newest");
  const [listingQuery, setListingQuery] = useState("");
  const [listingStateFilter, setListingStateFilter] = useState<ListingStateFilter>("ALL");
  const [listingSort, setListingSort] = useState<ListingSort>("newest");

  useEffect(() => {
    void refreshAll();
    void loadPopularSets();
  }, []);

  // Set autocomplete: search-as-you-type against the bundled offline set
  // catalog while the Set field is focused. Falls back to the curated
  // "popular sets" list when the field is empty, so opening the dropdown
  // on a blank field is still useful.
  useEffect(() => {
    if (!setSuggestionsOpen) return;
    const query = setNameValue.trim();
    if (!query) {
      setSetSuggestions(popularSets);
      return;
    }
    const handle = setTimeout(() => {
      fetch(`/api/catalog/search?q=${encodeURIComponent(query)}&limit=6`)
        .then(readJson)
        .then((payload) => setSetSuggestions(payload.sets ?? []))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(handle);
  }, [setNameValue, setSuggestionsOpen, popularSets]);

  useEffect(() => {
    if (!cardSuggestionsOpen) return;
    const query = name.trim();
    if (!query) {
      setCardSuggestions([]);
      return;
    }
    const handle = setTimeout(() => {
      const qs = new URLSearchParams({ q: query, limit: "8" });
      if (setNameValue.trim()) qs.set("set", setNameValue.trim());
      fetch(`/api/catalog/cards?${qs}`)
        .then(readJson)
        .then((payload) => setCardSuggestions(payload.cards ?? []))
        .catch(() => {});
    }, 180);
    return () => clearTimeout(handle);
  }, [name, setNameValue, cardSuggestionsOpen]);

  const activeInventory = useMemo(
    () => inventory.filter((item) => item.status !== "SOLD"),
    [inventory],
  );
  const soldInventory = useMemo(
    () => inventory.filter((item) => item.status === "SOLD"),
    [inventory],
  );
  const visibleActiveInventory = useMemo(
    () => buildInventoryView(activeInventory, { query: inventoryQuery, sort: inventorySort }),
    [activeInventory, inventoryQuery, inventorySort],
  );
  const visibleSoldInventory = useMemo(
    () => buildInventoryView(soldInventory, { query: inventoryQuery, sort: inventorySort }),
    [soldInventory, inventoryQuery, inventorySort],
  );
  const visibleListings = useMemo(
    () => buildListingView(listings, { query: listingQuery, state: listingStateFilter, sort: listingSort }),
    [listings, listingQuery, listingStateFilter, listingSort],
  );
  const headline = comp?.headline ?? null;
  const confidenceLabel = headline ? compConfidence(headline, comp?.sourcesDisagree ?? false) : null;
  const deal = useMemo(
    () => (headline ? judgeDeal(headline, poundsToPence(cost), poundsToPence(postage)) : null),
    [headline, cost, postage],
  );
  const gradeEv = useMemo(
    () =>
      headline && gradeComp
        ? calculateGradeEv({
            rawPence: headline.medianPence,
            psa10Pence: gradeComp.medianPence,
            oddsPct: Number(gradeOdds),
            gradingCostPence: poundsToPence(gradingCost),
          })
        : null,
    [headline, gradeComp, gradeOdds, gradingCost],
  );
  const spotlightImage =
    cardArtUrl ??
    activeInventory.find((item) => item.card.imageUrl)?.card.imageUrl ??
    listings.find((listing) => listing.item?.card.imageUrl)?.item?.card.imageUrl ??
    quickHunts[0]?.imageUrl ??
    null;
  const catalogCard = comp?.catalog ?? null;
  const selectedSet = useMemo(() => findSelectedSet([...popularSets, ...setSuggestions], setNameValue), [
    popularSets,
    setNameValue,
    setSuggestions,
  ]);
  const setMarkUrl =
    catalogCard?.setLogoUrl ?? catalogCard?.setSymbolUrl ?? selectedSet?.logoUrl ?? selectedSet?.symbolUrl ?? null;
  const marketBaseline =
    comp?.all.find((result) => result.source === "pokemon-tcg-market" && result.sampleSize > 0) ?? null;
  const ownedSalesComp =
    comp?.all.find((result) => result.source === "owned-sales" && result.sampleSize > 0) ?? null;
  const compReceipt = useMemo(() => (comp ? buildCompReceipt(comp) : []), [comp]);
  const compSpreadPct = useMemo(() => (comp ? medianSpreadPct(comp.all) : null), [comp]);
  const chaseLine = dashboard
    ? `${dashboard.metrics.stockCount} stocked / ${dashboard.metrics.soldCount} sold`
    : "loading deck";

  async function refreshAll() {
    setError(null);
    try {
      const [inventoryRes, listingsRes, dashboardRes, portfolioRes, watchesRes] = await Promise.all([
        fetch("/api/inventory"),
        fetch("/api/listings"),
        fetch("/api/dashboard"),
        fetch("/api/snapshots/portfolio"),
        fetch("/api/watches"),
      ]);
      const inventoryJson = await readJson(inventoryRes);
      const listingsJson = await readJson(listingsRes);
      const dashboardJson = await readJson(dashboardRes);
      const portfolioJson = await readJson(portfolioRes);
      const watchesJson = await readJson(watchesRes);
      if (!inventoryRes.ok) throw new Error(inventoryJson.error ?? "inventory failed");
      if (!listingsRes.ok) throw new Error(listingsJson.error ?? "listings failed");
      if (!dashboardRes.ok) throw new Error(dashboardJson.error ?? "dashboard failed");
      if (!portfolioRes.ok) throw new Error(portfolioJson.error ?? "snapshot history failed");
      if (!watchesRes.ok) throw new Error(watchesJson.error ?? "watches failed");
      setInventory(inventoryJson.items);
      setListings(listingsJson.listings);
      setDashboard(dashboardJson);
      setPortfolio(portfolioJson);
      const nextWatches = (watchesJson.watches ?? []) as WatchRecord[];
      setWatches(nextWatches);
      setWatchEdits((current) => {
        const next: Record<string, string> = {};
        for (const watch of nextWatches) next[watch.id] = current[watch.id] ?? penceToPounds(watch.targetPence);
        return next;
      });
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
      setCardArtUrl(payload.catalog?.imageUrl ?? null);
      setGradeComp(null);
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

  async function createWatch() {
    setBusy("watch-create");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card: { name, setName: setNameValue, number },
          grade,
          targetPence: poundsToPence(watchTarget),
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "watch create failed");
      setNotice(`Watching ${name} at ${gbp(poundsToPence(watchTarget))}.`);
      if (payload.watch?.id) {
        setWatchEdits((current) => ({ ...current, [payload.watch.id]: penceToPounds(payload.watch.targetPence) }));
      }
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "watch create failed");
    } finally {
      setBusy(null);
    }
  }

  async function patchWatch(
    watch: WatchRecord,
    patch: Partial<{ targetPence: number; active: boolean; grade: Grade }>,
    message: string,
  ) {
    setBusy(`watch-${watch.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/watches/${watch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "watch update failed");
      const updated = payload.watch as WatchRecord;
      setWatches((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      setWatchEdits((current) => ({ ...current, [updated.id]: penceToPounds(updated.targetPence) }));
      if (patch.active === false) setWatchHits((rows) => rows.filter((hit) => hit.watchId !== watch.id));
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "watch update failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveWatchTarget(watch: WatchRecord) {
    const value = watchEdits[watch.id] ?? penceToPounds(watch.targetPence);
    const targetPence = poundsToPence(value);
    if (targetPence <= 0) {
      setError("Enter a buy target above £0.");
      return;
    }
    await patchWatch(watch, { targetPence }, `Updated target for ${watch.card.name} to ${gbp(targetPence)}.`);
  }

  async function deleteWatch(watch: WatchRecord) {
    const ok = window.confirm(`Delete watch for ${watch.card.name} ${watch.grade.replace(/_/g, " ")}?`);
    if (!ok) return;
    setBusy(`watch-${watch.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/watches/${watch.id}`, { method: "DELETE" });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "watch delete failed");
      setWatches((rows) => rows.filter((row) => row.id !== watch.id));
      setWatchEdits((current) => {
        const next = { ...current };
        delete next[watch.id];
        return next;
      });
      setWatchHits((rows) => rows.filter((hit) => hit.watchId !== watch.id));
      setNotice("Watch deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "watch delete failed");
    } finally {
      setBusy(null);
    }
  }

  function chooseQuickHunt(card: (typeof quickHunts)[number]) {
    setName(card.name);
    setSetNameValue(card.setName);
    setNumber(card.number);
    setComp(null);
    setSuggestion(null);
    setCardArtUrl(card.imageUrl);
    setGradeComp(null);
    setNotice(null);
    setError(null);
  }

  async function loadPopularSets() {
    try {
      const res = await fetch("/api/catalog/sets");
      const payload = await readJson(res);
      if (res.ok) setPopularSets(payload.sets ?? []);
    } catch {
      // Offline/bundled catalog only -- if this somehow fails, the Set
      // field still works as a plain text input, so fail silently.
    }
  }

  function chooseSet(set: CatalogSet) {
    setSetNameValue(set.name);
    setSetSuggestionsOpen(false);
  }

  function chooseCard(card: CatalogCard) {
    setName(card.name);
    setSetNameValue(card.setName);
    if (card.number) setNumber(card.number);
    if (card.imageUrl) setCardArtUrl(card.imageUrl);
    setCardSuggestionsOpen(false);
    setError(null);
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
      const recommendations = (payload.recommendations ?? []) as RepriceRecommendation[];
      const count = recommendations.length;
      setRepriceRecommendations(recommendations);
      setRepriceCheckedAt(payload.checkedAt ?? new Date().toISOString());
      setDiscordReady(Boolean(payload.notifierConfigured));
      setRepriceMessage(
        count === 0
          ? "No repricing alerts right now."
          : `${count} repricing action${count === 1 ? "" : "s"} found${payload.notified ? " and sent" : ""}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "reprice check failed");
    } finally {
      setBusy(null);
    }
  }

  async function applyReprice(recommendation: RepriceRecommendation) {
    const item = inventory.find((row) => row.id === recommendation.itemId);
    const listing = item?.listings[0];
    if (!listing) {
      setError("No listing found for that stock row.");
      return;
    }
    await patchListing(
      listing,
      { listPricePence: recommendation.suggestedPricePence },
      `Repriced ${recommendation.cardName} to ${gbp(recommendation.suggestedPricePence)}.`,
    );
    setRepriceRecommendations((rows) => rows.filter((row) => row.itemId !== recommendation.itemId));
  }

  async function takePortfolioSnapshot() {
    setBusy("snapshot");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/snapshots/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "snapshot failed");
      setPortfolio(payload);
      setNotice(
        payload.written > 0
          ? `Snapshot saved for ${payload.written} stock line${payload.written === 1 ? "" : "s"}.`
          : "No stock values were updated.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "snapshot failed");
    } finally {
      setBusy(null);
    }
  }

  async function checkWatches() {
    setBusy("watch-check");
    setError(null);
    setWatchMessage(null);
    try {
      const res = await fetch("/api/watches/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify: true, limit: 10 }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "watch check failed");
      const hits = (payload.hits ?? []) as WatchHit[];
      setWatchHits(hits);
      setWatchCheckedAt(payload.checkedAt ?? new Date().toISOString());
      setWatchDiscordReady(Boolean(payload.notifierConfigured));
      setWatchMessage(
        hits.length === 0
          ? "No sourcing targets hit right now."
          : `${hits.length} sourcing target${hits.length === 1 ? "" : "s"} hit${payload.notified ? " and sent" : ""}.`,
      );
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "watch check failed");
    } finally {
      setBusy(null);
    }
  }

  async function lookupGradeEv() {
    setBusy("grade-ev");
    setError(null);
    try {
      const qs = new URLSearchParams({
        name,
        set: setNameValue,
        number,
        grade: "PSA_10",
      });
      const res = await fetch(`/api/comps?${qs}`);
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "grade check failed");
      setGradeComp(payload.headline);
      if (!cardArtUrl) setCardArtUrl(payload.catalog?.imageUrl ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "grade check failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          {spotlightImage ? (
            <img className="app-mark app-mark-image" src={spotlightImage} alt="" />
          ) : (
            <span className="app-mark" aria-hidden="true" />
          )}
          <div>
            <p className="eyebrow">Pokémon Dealer OS</p>
            <h1>{viewTitle(view)}</h1>
          </div>
          {setMarkUrl && (
            <img
              className="brand-set-logo"
              src={setMarkUrl}
              alt={`${selectedSet?.name ?? catalogCard?.setName ?? setNameValue} set logo`}
            />
          )}
        </div>
        <button className="icon-button" type="button" onClick={refreshAll} aria-label="Refresh data">
          ↻
        </button>
      </header>

      <section className="hero-board" aria-label="Dealer command board">
        <div className="hero-copy">
          <p className="eyebrow">Card fair mode</p>
          <strong>{chaseLine}</strong>
          <span>GBP comps, stock, listings and profit in one pocket.</span>
        </div>
        <div className="hero-card-art" aria-hidden="true">
          {spotlightImage ? <img src={spotlightImage} alt="" /> : <span className="card-back" />}
          {setMarkUrl && <img className="set-mark" src={setMarkUrl} alt="" />}
        </div>
      </section>

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
            <div className="quick-hunts" aria-label="Quick card picks">
              {quickHunts.map((card) => (
                <button key={`${card.name}-${card.number}`} type="button" onClick={() => chooseQuickHunt(card)}>
                  <img src={card.imageUrl} alt="" />
                  <span>{card.name}</span>
                </button>
              ))}
            </div>
            <label className="set-field">
              Card
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onFocus={() => setCardSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setCardSuggestionsOpen(false), 150)}
                placeholder="Charizard, Moonbreon, Mr Mime..."
                autoComplete="off"
              />
              {cardSuggestionsOpen && cardSuggestions.length > 0 && (
                <div className="set-suggestions card-suggestions" role="listbox" aria-label="Card suggestions">
                  {cardSuggestions.map((card) => (
                    <button
                      key={card.tcgApiId ?? `${card.name}-${card.setName}-${card.number ?? ""}`}
                      type="button"
                      className="suggestion-item card-option"
                      onClick={() => chooseCard(card)}
                    >
                      {card.imageUrl ? <img src={card.imageUrl} alt="" /> : null}
                      <span>{card.name}</span>
                      <small>
                        {card.setName}
                        {card.number ? ` #${card.number}` : ""}
                      </small>
                    </button>
                  ))}
                </div>
              )}
            </label>
            <div className="form-grid">
              <label className="set-field">
                Set
                <input
                  value={setNameValue}
                  onChange={(event) => setSetNameValue(event.target.value)}
                  onFocus={() => setSetSuggestionsOpen(true)}
                  onBlur={() => setTimeout(() => setSetSuggestionsOpen(false), 150)}
                  placeholder="base set, 151, SVI..."
                  autoComplete="off"
                />
                {setSuggestionsOpen && setSuggestions.length > 0 && (
                  <div className="set-suggestions" role="listbox" aria-label="Set suggestions">
                    {setSuggestions.map((set) => (
                      <button key={set.id} type="button" className="suggestion-item" onClick={() => chooseSet(set)}>
                        {set.symbolUrl ? <img src={set.symbolUrl} alt="" /> : null}
                        <span>{set.name}</span>
                        {set.ptcgoCode && <small>{set.ptcgoCode}</small>}
                      </button>
                    ))}
                  </div>
                )}
              </label>
              <label>
                Number
                <input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="199/165" />
              </label>
            </div>
            {popularSets.length > 0 && (
              <div className="set-chip-row" aria-label="Popular sets">
                {popularSets.map((set) => (
                  <button key={set.id} type="button" onClick={() => chooseSet(set)}>
                    {set.logoUrl || set.symbolUrl ? <img src={set.logoUrl ?? set.symbolUrl} alt="" /> : null}
                    <span>{set.name}</span>
                  </button>
                ))}
              </div>
            )}
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
            <section className="panel comp-panel">
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
              {compReceipt.length > 0 && (
                <div className="comp-receipt">
                  <div className="receipt-heading">
                    <span>Comp receipt</span>
                    <strong>{compSpreadPct == null ? "single signal" : `${compSpreadPct}% spread`}</strong>
                  </div>
                  <div className="receipt-list">
                    {compReceipt.map((row) => (
                      <div className={`receipt-row ${row.tone}`} key={row.key}>
                        <div>
                          <strong>{row.name}</strong>
                          <span>{row.basis}</span>
                        </div>
                        <div>
                          <strong>{row.price}</strong>
                          <span>{row.meta}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {marketBaseline && (
                <div className="market-signal">
                  <span>Catalog baseline</span>
                  <strong>{gbp(marketBaseline.medianPence)}</strong>
                  <small>{marketBaseline.raw?.chosenSignal?.label ?? "TCGPlayer/Cardmarket"}</small>
                </div>
              )}
              {ownedSalesComp && (
                <div className="owned-sales-signal">
                  <div>
                    <span>Owned sales</span>
                    <strong>{gbp(ownedSalesComp.medianPence)}</strong>
                    <small>
                      {ownedSalesComp.sampleSize} sold · latest {shortDate(ownedSalesComp.asOf)}
                    </small>
                  </div>
                  <div className="owned-sale-list">
                    {(ownedSalesComp.raw?.sales ?? []).slice(0, 3).map((sale) => (
                      <span key={sale.id}>
                        {gbp(sale.salePricePence)} · {shortDate(sale.soldAt)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {catalogCard && (
                <div className="catalog-strip">
                  {catalogCard.imageUrl ? (
                    <img className="catalog-art" src={catalogCard.imageUrl} alt={`${catalogCard.name} card art`} />
                  ) : (
                    <span className="catalog-art blank" aria-hidden="true" />
                  )}
                  <div>
                    <span>TCG catalog</span>
                    <strong>{catalogCard.name}</strong>
                    <small>
                      {catalogCard.setName}
                      {catalogCard.number ? ` #${catalogCard.number}` : ""}
                    </small>
                  </div>
                  {setMarkUrl && <img className="catalog-set-logo" src={setMarkUrl} alt={`${catalogCard.setName} logo`} />}
                </div>
              )}
              {headline.raw?.chosenPriceSource === "smartMarketPrice" && (
                <p className="hint">
                  RAW is using the provider smart price to reduce noisy ungraded eBay leakage.
                  {headline.raw.smartMarketPrice?.confidence
                    ? ` Confidence: ${headline.raw.smartMarketPrice.confidence}.`
                    : ""}
                </p>
              )}
              {headline.raw?.kind === "catalog-market-baseline" && (
                <p className="hint">
                  Using a catalog market baseline because sold comp data is thin or missing.
                  {headline.raw.caveat ? ` ${headline.raw.caveat}` : ""}
                </p>
              )}
              {comp?.sourcesDisagree && (
                <p className="hint danger-text">Sources disagree materially. Treat this as a check-before-buy price.</p>
              )}
              {deal && (
                <div className={`deal-card ${deal.tone}`}>
                  <div>
                    <span>Deal judge</span>
                    <strong>{deal.label}</strong>
                  </div>
                  <div>
                    <span>Net profit</span>
                    <strong>{gbp(deal.expectedProfitPence)}</strong>
                  </div>
                  <div>
                    <span>Target buy</span>
                    <strong>{gbp(deal.targetBuyPence)}</strong>
                  </div>
                </div>
              )}
            </section>
          )}

          {headline && grade === "RAW" && (
            <section className="panel grade-lab">
              <div className="panel-heading">
                <h2>Grade lab</h2>
                <span className="muted">RAW to PSA 10 EV</span>
              </div>
              <div className="form-grid">
                <label>
                  PSA 10 odds %
                  <input inputMode="decimal" value={gradeOdds} onChange={(event) => setGradeOdds(event.target.value)} />
                </label>
                <label>
                  Grade cost GBP
                  <input inputMode="decimal" value={gradingCost} onChange={(event) => setGradingCost(event.target.value)} />
                </label>
              </div>
              <button className="secondary-action" type="button" onClick={lookupGradeEv} disabled={busy === "grade-ev"}>
                {busy === "grade-ev" ? "Checking slab..." : "Check PSA 10 EV"}
              </button>
              {gradeEv && gradeComp && (
                <div className={`grade-verdict ${gradeEv.liftPence >= 0 ? "good" : "warn"}`}>
                  <span>PSA 10 comp {gbp(gradeComp.medianPence)}</span>
                  <strong>{gradeEv.liftPence >= 0 ? "+" : ""}{gbp(gradeEv.liftPence)} EV lift</strong>
                </div>
              )}
            </section>
          )}

          {headline && (
            <section className="panel watch-panel">
              <div className="panel-heading">
                <h2>Buy target</h2>
                <span className="muted">{watches.filter((watch) => watch.active).length} watched</span>
              </div>
              <div className="form-grid">
                <label>
                  Target GBP
                  <input inputMode="decimal" value={watchTarget} onChange={(event) => setWatchTarget(event.target.value)} />
                </label>
                <label>
                  Target grade
                  <input value={grade.replace(/_/g, " ")} readOnly />
                </label>
              </div>
              <button className="secondary-action" type="button" onClick={createWatch} disabled={busy === "watch-create"}>
                {busy === "watch-create" ? "Saving watch..." : "Watch for buy price"}
              </button>
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
            <span>{rowCountLabel(visibleActiveInventory.length, activeInventory.length)}</span>
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
          {visibleActiveInventory.map((item) => (
            <InventoryRow
              key={item.id}
              item={item}
              busy={busy}
              onSell={openSell}
              onStatus={updateStatus}
              onDelete={deleteItem}
            />
          ))}
          {activeInventory.length === 0 ? (
            <EmptyState text="No active stock. Acquire your next buy from the first tab." />
          ) : visibleActiveInventory.length === 0 ? (
            <EmptyState text="No matching active stock. Clear the search or change the sort." />
          ) : null}

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
                <span>{rowCountLabel(visibleSoldInventory.length, soldInventory.length)}</span>
              </div>
              {visibleSoldInventory.slice(0, 8).map((item) => (
                <InventoryRow
                  key={item.id}
                  item={item}
                  busy={busy}
                  onSell={openSell}
                  onStatus={updateStatus}
                  onDelete={deleteItem}
                />
              ))}
              {visibleSoldInventory.length === 0 && <EmptyState text="No matching sold rows." />}
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
          <div className="export-actions" aria-label="Listing exports">
            <a className="export-link" href="/api/export/listings?state=DRAFT" download>
              Draft CSV
            </a>
            <a className="export-link" href="/api/export/listings" download>
              All listings CSV
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
          <div className="section-heading tight">
            <h2>Listings</h2>
            <span>{rowCountLabel(visibleListings.length, listings.length)}</span>
          </div>
          {visibleListings.map((listing) => (
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
          {listings.length === 0 ? (
            <EmptyState text="No listings yet. Acquire can create draft listings automatically." />
          ) : visibleListings.length === 0 ? (
            <EmptyState text="No matching listings. Clear the search or change the state filter." />
          ) : null}
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
          <div className="export-actions single" aria-label="Books export">
            <a className="export-link" href="/api/export/books" download>
              Books CSV
            </a>
          </div>
          <section className="panel portfolio-panel">
            <div className="panel-heading">
              <h2>Stock value</h2>
              <span className="muted">
                {portfolio?.latest ? `${portfolio.latest.snapshotCount} priced` : "No snapshot"}
              </span>
            </div>
            <div className="portfolio-value">
              <strong>{gbp(portfolio?.latest?.marketValuePence ?? 0)}</strong>
              <span className={portfolio?.changePence == null ? "" : portfolio.changePence >= 0 ? "good" : "warn"}>
                {portfolio?.changePence == null
                  ? "Take a snapshot to start the trend."
                  : `${portfolio.changePence >= 0 ? "+" : ""}${gbp(portfolio.changePence)} (${portfolio.changePct}%)`}
              </span>
            </div>
            {portfolio?.points.length ? (
              <div className="portfolio-trend" aria-label="Portfolio value history">
                {portfolio.points.slice(-7).map((point) => (
                  <div className="trend-row" key={point.date}>
                    <span>{shortDate(point.date)}</span>
                    <div>
                      <i style={{ width: `${trendBarWidth(point, portfolio.points)}%` }} />
                    </div>
                    <strong>{gbp(point.marketValuePence)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            <button className="secondary-action" type="button" onClick={takePortfolioSnapshot} disabled={busy === "snapshot"}>
              {busy === "snapshot" ? "Valuing stock..." : "Snapshot stock value"}
            </button>
            {portfolio?.checkedAt && <p className="hint">Last valued {ageLabel(portfolio.checkedAt)}.</p>}
          </section>
          <section className="panel watch-panel">
            <div className="panel-heading">
              <h2>Buy watches</h2>
              <span className="muted">{watches.filter((watch) => watch.active).length} active</span>
            </div>
            <button className="primary-action" type="button" onClick={checkWatches} disabled={busy === "watch-check"}>
              {busy === "watch-check" ? "Checking..." : "Check buy targets"}
            </button>
            {watchMessage && <p className="hint">{watchMessage}</p>}
            {(watchCheckedAt || watchDiscordReady !== null) && (
              <div className="alert-status">
                <span>{watchCheckedAt ? `Checked ${ageLabel(watchCheckedAt)}` : "Not checked"}</span>
                <strong>{watchDiscordReady ? "Discord ready" : "In-app only"}</strong>
              </div>
            )}
            {watchHits.length > 0 ? (
              <div className="watch-hit-list">
                {watchHits.map((hit) => (
                  <WatchHitRow key={hit.watchId} hit={hit} />
                ))}
              </div>
            ) : (
              <div className="watch-list">
                {watches.slice(0, 6).map((watch) => (
                  <WatchRow
                    key={watch.id}
                    watch={watch}
                    editValue={watchEdits[watch.id] ?? penceToPounds(watch.targetPence)}
                    busy={busy === `watch-${watch.id}`}
                    onEditValue={(value) => setWatchEdits((current) => ({ ...current, [watch.id]: value }))}
                    onSave={() => saveWatchTarget(watch)}
                    onToggle={() =>
                      patchWatch(
                        watch,
                        { active: !watch.active },
                        watch.active ? `${watch.card.name} watch paused.` : `${watch.card.name} watch resumed.`,
                      )
                    }
                    onDelete={() => deleteWatch(watch)}
                  />
                ))}
                {watches.length === 0 && <p className="empty-state">No buy watches yet.</p>}
              </div>
            )}
          </section>
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
            {(repriceCheckedAt || discordReady !== null) && (
              <div className="alert-status">
                <span>{repriceCheckedAt ? `Checked ${ageLabel(repriceCheckedAt)}` : "Not checked"}</span>
                <strong>{discordReady ? "Discord ready" : "In-app only"}</strong>
              </div>
            )}
            {repriceRecommendations.length > 0 && (
              <div className="reprice-list">
                {repriceRecommendations.map((recommendation) => (
                  <RepriceActionRow
                    key={recommendation.itemId}
                    recommendation={recommendation}
                    busy={busy === `listing-${inventory.find((row) => row.id === recommendation.itemId)?.listings[0]?.id}`}
                    canApply={Boolean(inventory.find((row) => row.id === recommendation.itemId)?.listings[0])}
                    onApply={applyReprice}
                  />
                ))}
              </div>
            )}
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
        <TabButton active={view === "acquire"} label="Catch" onClick={() => setView("acquire")} />
        <TabButton active={view === "inventory"} label="Dex" onClick={() => setView("inventory")} />
        <TabButton active={view === "listings"} label="Market" onClick={() => setView("listings")} />
        <TabButton active={view === "pnl"} label="Loot" onClick={() => setView("pnl")} />
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
          <span className="item-badges">
            <GradeBadge grade={item.grade} />
            <span className={`pill ${statusTone(item.status)}`}>{item.status.replace(/_/g, " ")}</span>
          </span>
        </div>
        <p>
          {item.card.setName} {item.card.number ?? "no number"} · cost {gbp(item.costBasis)}
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
          <span className="item-badges">
            {listing.item && <GradeBadge grade={listing.item.grade} />}
            <span className={`pill ${listingTone(listing.state)}`}>{listing.state.toLowerCase()}</span>
          </span>
        </div>
        <p>
          {channelLabel(listing.channel)}
          {listing.item?.card.setName ? ` · ${listing.item.card.setName}` : ""}
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

function RepriceActionRow({
  recommendation,
  busy,
  canApply,
  onApply,
}: {
  recommendation: RepriceRecommendation;
  busy: boolean;
  canApply: boolean;
  onApply: (recommendation: RepriceRecommendation) => void;
}) {
  return (
    <article className={`reprice-row ${recommendation.movePct >= 0 ? "raise" : "drop"}`}>
      <div>
        <strong>{recommendation.cardName}</strong>
        <span>
          {recommendation.grade.replace(/_/g, " ")} · {recommendation.confidence} · {recommendation.movePct > 0 ? "+" : ""}
          {recommendation.movePct}%
        </span>
      </div>
      <div>
        <span>
          {gbp(recommendation.currentPricePence)} → {gbp(recommendation.suggestedPricePence)}
        </span>
        <button
          type="button"
          onClick={() => onApply(recommendation)}
          disabled={busy || !canApply}
        >
          {busy ? "Saving..." : "Apply"}
        </button>
      </div>
    </article>
  );
}

function WatchRow({
  watch,
  editValue,
  busy,
  onEditValue,
  onSave,
  onToggle,
  onDelete,
}: {
  watch: WatchRecord;
  editValue: string;
  busy: boolean;
  onEditValue: (value: string) => void;
  onSave: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const latest = watch.alerts?.[0];
  return (
    <article className={`watch-row ${watch.active ? "" : "inactive"}`}>
      {watch.card.imageUrl ? <img src={watch.card.imageUrl} alt="" /> : <span aria-hidden="true" />}
      <div className="watch-main">
        <div className="watch-title-line">
          <strong>{watch.card.name}</strong>
          <span className={`pill ${watch.active ? "good" : ""}`}>{watch.active ? "active" : "paused"}</span>
        </div>
        <span>
          {watch.card.number ?? "no number"} · {watch.grade.replace(/_/g, " ")}
        </span>
        {latest && <small>Last hit {shortDate(latest.firedAt)} at {latest.pence ? gbp(latest.pence) : "n/a"}</small>}
        <div className="watch-controls">
          <label>
            Target GBP
            <input
              inputMode="decimal"
              value={editValue}
              onChange={(event) => onEditValue(event.target.value)}
              disabled={busy}
            />
          </label>
          <button type="button" onClick={onSave} disabled={busy}>
            Save
          </button>
          <button type="button" onClick={onToggle} disabled={busy}>
            {watch.active ? "Pause" : "Resume"}
          </button>
          <button className="danger-button" type="button" onClick={onDelete} disabled={busy}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function WatchHitRow({ hit }: { hit: WatchHit }) {
  return (
    <article className="watch-hit-row">
      <div>
        <strong>{hit.cardName}</strong>
        <span>{hit.grade.replace(/_/g, " ")} · {hit.sampleSize}/{hit.windowDays}d</span>
      </div>
      <div>
        <strong>{gbp(hit.marketPence)}</strong>
        <span>target {gbp(hit.targetPence)}</span>
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

function GradeBadge({ grade }: { grade: string }) {
  return <span className={`grade-badge ${gradeTone(grade)}`}>{grade.replace(/_/g, " ")}</span>;
}

function rowCountLabel(visible: number, total: number): string {
  return visible === total ? `${total} row${total === 1 ? "" : "s"}` : `${visible}/${total} rows`;
}

function compConfidence(comp: CompResult, sourcesDisagree: boolean): { label: string; tone: string } {
  if (comp.sampleSize === 0) return { label: "No comps", tone: "danger" };
  if (sourcesDisagree) return { label: "Cross-check", tone: "warn" };
  if (comp.sampleSize < 3) return { label: "Thin", tone: "warn" };
  return { label: "Usable", tone: "good" };
}

function judgeDeal(
  comp: CompResult,
  costBasisPence: number,
  postagePence: number,
): {
  label: string;
  tone: "good" | "warn" | "danger";
  expectedProfitPence: number;
  targetBuyPence: number;
} {
  if (comp.sampleSize === 0 || comp.medianPence <= 0) {
    return { label: "No signal", tone: "danger", expectedProfitPence: 0, targetBuyPence: 0 };
  }
  const fees = Math.round(comp.medianPence * 0.128) + 30;
  const net = comp.medianPence - fees - postagePence;
  const expectedProfitPence = net - costBasisPence;
  const targetBuyPence = Math.max(0, Math.round(net * 0.7));
  const roi = costBasisPence > 0 ? expectedProfitPence / costBasisPence : 0;
  if (expectedProfitPence > 0 && roi >= 0.35 && comp.sampleSize >= 3) {
    return { label: "Catch", tone: "good", expectedProfitPence, targetBuyPence };
  }
  if (expectedProfitPence > 0 && roi >= 0.1) {
    return { label: "Watch", tone: "warn", expectedProfitPence, targetBuyPence };
  }
  return { label: "Pass", tone: "danger", expectedProfitPence, targetBuyPence };
}

function calculateGradeEv({
  rawPence,
  psa10Pence,
  oddsPct,
  gradingCostPence,
}: {
  rawPence: number;
  psa10Pence: number;
  oddsPct: number;
  gradingCostPence: number;
}): { liftPence: number; expectedValuePence: number } {
  const odds = Math.max(0, Math.min(100, Number.isFinite(oddsPct) ? oddsPct : 0)) / 100;
  const expectedValuePence = Math.round(psa10Pence * odds + rawPence * (1 - odds) - gradingCostPence);
  return {
    expectedValuePence,
    liftPence: expectedValuePence - rawPence,
  };
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

function gradeTone(grade: string): string {
  if (grade === "RAW") return "raw";
  if (grade.startsWith("PSA")) return "psa";
  if (grade.startsWith("BGS")) return "bgs";
  if (grade.startsWith("CGC")) return "cgc";
  return "";
}

function buildCompReceipt(comp: Reconciled): Array<{
  key: string;
  name: string;
  basis: string;
  price: string;
  meta: string;
  tone: string;
}> {
  return [...comp.all]
    .sort((a, b) => receiptRank(a, comp.headline) - receiptRank(b, comp.headline))
    .map((result) => ({
      key: `${result.source}-${result.grade}-${result.asOf}`,
      name: sourceLabel(result.source, result.source === comp.headline.source),
      basis: compBasis(result),
      price: result.sampleSize > 0 && result.medianPence > 0 ? gbp(result.medianPence) : "No data",
      meta: compMeta(result),
      tone: receiptTone(result, comp.headline, comp.sourcesDisagree),
    }));
}

function receiptRank(result: CompResult, headline: CompResult): number {
  if (result.source === headline.source) return 0;
  if (result.source === "owned-sales") return 1;
  if (result.source === "poketrace") return 2;
  if (result.source === "pokemon-tcg-market") return 3;
  return 4;
}

function sourceLabel(source: string, headline: boolean): string {
  const label =
    source === "pokemon-price-tracker"
      ? "Price Tracker"
      : source === "poketrace"
        ? "PokeTrace"
      : source === "pokemon-tcg-market"
        ? "Catalog"
        : source === "owned-sales"
          ? "Owned sales"
          : source.replace(/-/g, " ");
  return headline ? `${label} · used` : label;
}

function compBasis(result: CompResult): string {
  if (result.source === "owned-sales") return "Your sold prices";
  if (result.source === "poketrace") {
    const raw = result.raw as { priceSource?: string; tier?: string; kind?: string } | undefined;
    const source = raw?.priceSource === "tcgplayer" ? "TCGPlayer" : raw?.priceSource === "ebay" ? "eBay" : "PokeTrace";
    const tier = raw?.tier ? raw.tier.replace(/_/g, " ") : result.grade.replace(/_/g, " ");
    return raw?.kind === "market-baseline" ? `${source} ${tier} baseline` : `${source} ${tier} aggregate`;
  }
  if (result.raw?.kind === "catalog-market-baseline") {
    return result.raw.chosenSignal?.label ?? "TCGPlayer/Cardmarket baseline";
  }
  if (result.raw?.chosenPriceSource === "smartMarketPrice") {
    const confidence = result.raw.smartMarketPrice?.confidence;
    return confidence ? `Smart RAW · ${confidence}` : "Smart RAW";
  }
  if (result.sampleSize === 0) return "No matching signal";
  return `${result.grade.replace(/_/g, " ")} sold aggregate`;
}

function compMeta(result: CompResult): string {
  const sample =
    result.source === "pokemon-tcg-market"
      ? "baseline"
      : `${result.sampleSize} sample${result.sampleSize === 1 ? "" : "s"}`;
  return `${sample} / ${result.windowDays}d · ${ageLabel(result.asOf)}`;
}

function receiptTone(result: CompResult, headline: CompResult, sourcesDisagree: boolean): string {
  if (result.sampleSize === 0 || result.medianPence <= 0) return "danger";
  if (result.source === headline.source && !sourcesDisagree) return "good";
  if (sourcesDisagree && result.source === headline.source) return "warn";
  if (result.sampleSize < 3) return "warn";
  if (result.source === "pokemon-tcg-market" || result.source === "poketrace") return "info";
  return "";
}

function medianSpreadPct(results: CompResult[]): number | null {
  const medians = results.map((result) => result.medianPence).filter((median) => median > 0);
  if (medians.length < 2) return null;
  const min = Math.min(...medians);
  const max = Math.max(...medians);
  return Math.round(((max - min) / min) * 100);
}

function trendBarWidth(point: PortfolioPoint, points: PortfolioPoint[]): number {
  const max = Math.max(...points.map((row) => row.marketValuePence), 1);
  return Math.max(8, Math.round((point.marketValuePence / max) * 100));
}

function ageLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const ageDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)));
  if (ageDays === 0) return "today";
  if (ageDays === 1) return "1d old";
  if (ageDays <= 30) return `${ageDays}d old`;
  return shortDate(value);
}

function viewTitle(view: View): string {
  if (view === "acquire") return "Catch the deal";
  if (view === "inventory") return "Dealer Pokédex";
  if (view === "listings") return "PokéMart";
  return "Loot report";
}

function channelLabel(channel: Channel): string {
  return channel.replace("_", "-").toLowerCase();
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function findSelectedSet(sets: CatalogSet[], value: string): CatalogSet | null {
  const query = value.trim().toLowerCase();
  if (!query) return null;
  return (
    sets.find((set) => set.name.toLowerCase() === query || set.ptcgoCode?.toLowerCase() === query) ??
    sets.find((set) => set.name.toLowerCase().includes(query)) ??
    null
  );
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
