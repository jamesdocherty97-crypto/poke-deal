"use client";

import { type FormEvent, type SyntheticEvent, type TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  buildInventoryView,
  buildListingView,
  type InventorySort,
  type ListingSort,
  type ListingStateFilter,
} from "@/lib/dealer/tableControls";
import { buildProfitTrend, type ProfitTrendPoint } from "@/lib/dealer/metrics";
import {
  DEFAULT_QUICK_HUNTS,
  parseQuickHunts,
  pinQuickHunt,
  removeQuickHunt,
  serializeQuickHunts,
  type QuickHuntCard,
} from "@/lib/dealer/quickHunts";
import { buildListingDraftDefaults } from "@/lib/dealer/listingDraft";
import { pullRefreshDistance, pullRefreshProgress, shouldTriggerPullRefresh } from "@/lib/dealer/pullRefresh";
import { estimateSaleCosts, saleNetPence } from "@/lib/dealer/saleFees";
import { inventorySwipeAction, inventorySwipeOffset } from "@/lib/dealer/swipeActions";
import { buildTodayActions, type TodayAction, type TodayActionTarget } from "@/lib/dealer/today";

type View = "today" | "acquire" | "inventory" | "listings" | "pnl";
type Grade = "RAW" | "PSA_9" | "PSA_10" | "BGS_9_5" | "CGC_10";
type Channel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
type ItemStatus = "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
type ListingState = "DRAFT" | "ACTIVE" | "SOLD" | "ENDED";
type ExpenseCategory = "SUPPLIES" | "POSTAGE" | "GRADING" | "TABLE_FEE" | "TRAVEL" | "PLATFORM" | "OTHER";

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
  series?: string;
  releaseDate?: string;
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

type ExpenseRecord = {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  spentAt: string;
  channel: Channel | null;
  source: string | null;
  notes: string | null;
  createdAt: string;
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
    operatingExpensePence: number;
    netProfitPence: number;
    realizedMarginPct: number | null;
    sellThroughPct: number;
    averageAgeDays: number;
    agedStockCount: number;
    bestSale: SaleSummary | null;
    worstSale: SaleSummary | null;
  };
  recentSales: SaleSummary[];
  recentExpenses: ExpenseRecord[];
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

type SystemStatus = {
  sources: SystemSource[];
  summary: {
    livePrimaryComps: boolean;
    liveCatalogKey: boolean;
    secondaryCrossCheck: boolean;
    alertDelivery: boolean;
    storedSales: boolean;
  };
};

type SystemSource = {
  id: string;
  label: string;
  role: string;
  status: "ready" | "public" | "fixture" | "missing" | "building";
  required: boolean;
};

const grades: Grade[] = ["RAW", "PSA_9", "PSA_10", "BGS_9_5", "CGC_10"];
const channels: Channel[] = ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"];
const expenseCategories: ExpenseCategory[] = ["SUPPLIES", "POSTAGE", "GRADING", "TABLE_FEE", "TRAVEL", "PLATFORM", "OTHER"];
const editableStatuses: ItemStatus[] = ["IN_STOCK", "LISTED", "RESERVED"];
const QUICK_HUNTS_STORAGE_KEY = "pokemon-dealer-os.quick-hunts.v1";
const sourcePresets = ["Card fair", "Facebook", "eBay", "Cardmarket", "Vinted", "Trade-in"];
const locationPresets = ["Box A", "Box B", "Binder", "To list", "Slabs", "Singles"];
const expensePresets: Array<{ category: ExpenseCategory; description: string; amount?: string; channel?: Channel }> = [
  { category: "POSTAGE", description: "Postage supplies", amount: "5.00" },
  { category: "SUPPLIES", description: "Sleeves / toploaders", amount: "10.00" },
  { category: "TABLE_FEE", description: "Card fair table", amount: "15.00", channel: "IN_PERSON" },
  { category: "GRADING", description: "Grading submission", amount: "19.99" },
  { category: "TRAVEL", description: "Travel to buy stock", amount: "5.00", channel: "IN_PERSON" },
];

type RefreshOptions = {
  toast?: boolean;
  user?: boolean;
};

export default function Home() {
  const [view, setView] = useState<View>("today");
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
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [userRefreshing, setUserRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemQuantity, setItemQuantity] = useState("1");
  const [itemCost, setItemCost] = useState("");
  const [itemSource, setItemSource] = useState("");
  const [itemLocation, setItemLocation] = useState("");
  const [itemStatus, setItemStatus] = useState<ItemStatus>("IN_STOCK");
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "inventory"; item: InventoryItem } | { kind: "watch"; watch: WatchRecord } | null
  >(null);
  const [salePrice, setSalePrice] = useState("");
  const [fees, setFees] = useState("");
  const [postage, setPostage] = useState("1.20");
  const [soldAt, setSoldAt] = useState(todayInputValue());
  const [saleChannel, setSaleChannel] = useState<Channel>("EBAY");
  const [feesTouched, setFeesTouched] = useState(false);
  const [postageTouched, setPostageTouched] = useState(false);
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>("SUPPLIES");
  const [expenseDescription, setExpenseDescription] = useState("Postage supplies");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseSpentAt, setExpenseSpentAt] = useState(todayInputValue());
  const [expenseChannel, setExpenseChannel] = useState<Channel | "">("");
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
  const [creatingListingItemId, setCreatingListingItemId] = useState<string | null>(null);
  const [listingPrice, setListingPrice] = useState("");
  const [listingState, setListingState] = useState<Exclude<ListingState, "SOLD">>("DRAFT");
  const [listingChannel, setListingChannel] = useState<Channel>("EBAY");
  const [listingExternalUrl, setListingExternalUrl] = useState("");
  const [cardArtUrl, setCardArtUrl] = useState<string | null>(null);
  const [gradeComp, setGradeComp] = useState<CompResult | null>(null);
  const [gradeOdds, setGradeOdds] = useState("45");
  const [gradingCost, setGradingCost] = useState("19.99");
  const [popularSets, setPopularSets] = useState<CatalogSet[]>([]);
  const [allSets, setAllSets] = useState<CatalogSet[]>([]);
  const [setSuggestions, setSetSuggestions] = useState<CatalogSet[]>([]);
  const [setSuggestionsOpen, setSetSuggestionsOpen] = useState(false);
  const [cardSuggestions, setCardSuggestions] = useState<CatalogCard[]>([]);
  const [cardSuggestionsOpen, setCardSuggestionsOpen] = useState(false);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventorySort, setInventorySort] = useState<InventorySort>("newest");
  const [listingQuery, setListingQuery] = useState("");
  const [listingStateFilter, setListingStateFilter] = useState<ListingStateFilter>("ALL");
  const [listingSort, setListingSort] = useState<ListingSort>("newest");
  const [quickHunts, setQuickHunts] = useState<QuickHuntCard[]>(DEFAULT_QUICK_HUNTS);
  const pullStartY = useRef<number | null>(null);
  const pullTracking = useRef(false);

  useEffect(() => {
    void refreshAll();
    void loadSetCatalog();
  }, []);

  useEffect(() => {
    try {
      setQuickHunts(parseQuickHunts(window.localStorage.getItem(QUICK_HUNTS_STORAGE_KEY)));
    } catch {
      setQuickHunts(DEFAULT_QUICK_HUNTS);
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const handle = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(handle);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const handle = window.setTimeout(() => setError(null), 6500);
    return () => window.clearTimeout(handle);
  }, [error]);

  // Set autocomplete: search-as-you-type against the bundled offline set
  // catalog while the Set field is focused. Falls back to the curated
  // "popular sets" list plus newest cached sets when the field is empty,
  // so opening the dropdown on a blank field is still useful.
  useEffect(() => {
    if (!setSuggestionsOpen) return;
    const query = setNameValue.trim();
    if (!query) {
      setSetSuggestions(buildDefaultSetSuggestions(popularSets, allSets));
      return;
    }
    const handle = setTimeout(() => {
      fetch(`/api/catalog/search?q=${encodeURIComponent(query)}&limit=16`)
        .then(readJson)
        .then((payload) => setSetSuggestions(payload.sets ?? []))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(handle);
  }, [setNameValue, setSuggestionsOpen, popularSets, allSets]);

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

  useEffect(() => {
    if (!sellingId) return;
    const estimate = estimateSaleCosts(saleChannel, poundsToPence(salePrice));
    if (!feesTouched) setFees(penceToPounds(estimate.feesPence));
    if (!postageTouched) setPostage(penceToPounds(estimate.postagePence));
  }, [feesTouched, postageTouched, saleChannel, salePrice, sellingId]);

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
  const sellingItem = useMemo(
    () => inventory.find((item) => item.id === sellingId) ?? null,
    [inventory, sellingId],
  );
  const creatingListingItem = useMemo(
    () => inventory.find((item) => item.id === creatingListingItemId) ?? null,
    [creatingListingItemId, inventory],
  );
  const salePreview = useMemo(() => {
    if (!sellingItem) return null;
    const salePricePence = poundsToPence(salePrice);
    const feesPence = poundsToPence(fees);
    const postagePence = poundsToPence(postage);
    const netPence = saleNetPence({ salePricePence, feesPence, postagePence });
    return {
      netPence,
      profitPence: netPence - sellingItem.costBasis,
    };
  }, [fees, postage, salePrice, sellingItem]);
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
  const catalogCard = comp?.catalog ?? null;
  const selectedSet = useMemo(() => findSelectedSet([...popularSets, ...setSuggestions, ...allSets], setNameValue), [
    allSets,
    popularSets,
    setNameValue,
    setSuggestions,
  ]);
  const setMarkUrl =
    catalogCard?.setLogoUrl ?? catalogCard?.setSymbolUrl ?? selectedSet?.logoUrl ?? selectedSet?.symbolUrl ?? null;
  const matchingQuickHunt = quickHunts.find(
    (card) =>
      card.name.trim().toLowerCase() === name.trim().toLowerCase() &&
      card.setName.trim().toLowerCase() === setNameValue.trim().toLowerCase() &&
      card.number.trim().toLowerCase() === number.trim().toLowerCase(),
  );
  const selectedCardImage = cardArtUrl ?? catalogCard?.imageUrl ?? matchingQuickHunt?.imageUrl ?? null;
  const selectedCardMarkUrl = setMarkUrl ?? matchingQuickHunt?.setMarkUrl ?? null;
  const spotlightImage =
    selectedCardImage ??
    activeInventory.find((item) => item.card.imageUrl)?.card.imageUrl ??
    listings.find((listing) => listing.item?.card.imageUrl)?.item?.card.imageUrl ??
    quickHunts[0]?.imageUrl ??
    null;
  const marketBaseline =
    comp?.all.find((result) => result.source === "pokemon-tcg-market" && result.sampleSize > 0) ?? null;
  const ownedSalesComp =
    comp?.all.find((result) => result.source === "owned-sales" && result.sampleSize > 0) ?? null;
  const compReceipt = useMemo(() => (comp ? buildCompReceipt(comp) : []), [comp]);
  const compSpreadPct = useMemo(() => (comp ? medianSpreadPct(comp.all) : null), [comp]);
  const dashboardLoading = dashboard === null;
  const noBookedSales = !dashboardLoading && (dashboard?.metrics.soldCount ?? 0) === 0;
  const netProfitPence = dashboard?.metrics.netProfitPence ?? dashboard?.metrics.realizedProfitPence ?? 0;
  const netProfitTone = netProfitPence >= 0 ? "good" : "warn";
  const profitTrend = useMemo(() => buildProfitTrend(dashboard?.recentSales ?? []), [dashboard?.recentSales]);
  const chaseLine = dashboard
    ? `${dashboard.metrics.stockCount} stocked / ${dashboard.metrics.soldCount} sold`
    : "loading deck";
  const draftListingCount = Number(dashboard?.listingsByState.DRAFT ?? 0);
  const activeListingCount = Number(dashboard?.listingsByState.ACTIVE ?? 0);
  const activeWatchCount = watches.filter((watch) => watch.active).length;
  const unlistedStockCount = activeInventory.filter(
    (item) => !item.listings.some((listing) => listing.state === "DRAFT" || listing.state === "ACTIVE"),
  ).length;
  const todayActions = useMemo(
    () =>
      buildTodayActions({
        stockCount: dashboard?.metrics.stockCount ?? activeInventory.length,
        activeStockCount: activeInventory.length,
        soldCount: dashboard?.metrics.soldCount ?? soldInventory.length,
        draftListings: draftListingCount,
        activeListings: activeListingCount,
        activeWatches: activeWatchCount,
        agedStockCount: dashboard?.metrics.agedStockCount ?? 0,
        unlistedStockCount,
      }),
    [
      activeInventory.length,
      activeListingCount,
      activeWatchCount,
      dashboard?.metrics.agedStockCount,
      dashboard?.metrics.soldCount,
      dashboard?.metrics.stockCount,
      draftListingCount,
      soldInventory.length,
      unlistedStockCount,
    ],
  );

  async function refreshAll(options: RefreshOptions = {}) {
    setRefreshing(true);
    if (options.user) setUserRefreshing(true);
    setError(null);
    try {
      const [inventoryRes, listingsRes, dashboardRes, portfolioRes, watchesRes, expensesRes, systemRes] = await Promise.all([
        fetch("/api/inventory"),
        fetch("/api/listings"),
        fetch("/api/dashboard"),
        fetch("/api/snapshots/portfolio"),
        fetch("/api/watches"),
        fetch("/api/expenses"),
        fetch("/api/system/status"),
      ]);
      const inventoryJson = await readJson(inventoryRes);
      const listingsJson = await readJson(listingsRes);
      const dashboardJson = await readJson(dashboardRes);
      const portfolioJson = await readJson(portfolioRes);
      const watchesJson = await readJson(watchesRes);
      const expensesJson = await readJson(expensesRes);
      const systemJson = await readJson(systemRes);
      if (!inventoryRes.ok) throw new Error(inventoryJson.error ?? "inventory failed");
      if (!listingsRes.ok) throw new Error(listingsJson.error ?? "listings failed");
      if (!dashboardRes.ok) throw new Error(dashboardJson.error ?? "dashboard failed");
      if (!portfolioRes.ok) throw new Error(portfolioJson.error ?? "snapshot history failed");
      if (!watchesRes.ok) throw new Error(watchesJson.error ?? "watches failed");
      if (!expensesRes.ok) throw new Error(expensesJson.error ?? "expenses failed");
      if (!systemRes.ok) throw new Error(systemJson.error ?? "system status failed");
      setInventory(inventoryJson.items);
      setListings(listingsJson.listings);
      setDashboard(dashboardJson);
      setPortfolio(portfolioJson);
      setExpenses(expensesJson.expenses ?? []);
      setSystemStatus(systemJson);
      const nextWatches = (watchesJson.watches ?? []) as WatchRecord[];
      setWatches(nextWatches);
      setWatchEdits((current) => {
        const next: Record<string, string> = {};
        for (const watch of nextWatches) next[watch.id] = current[watch.id] ?? penceToPounds(watch.targetPence);
        return next;
      });
      if (options.toast) setNotice("Refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "refresh failed");
    } finally {
      setRefreshing(false);
      if (options.user) setUserRefreshing(false);
    }
  }

  function openTodayAction(target: TodayActionTarget) {
    if (target === "buy") {
      setView("acquire");
      return;
    }
    if (target === "stock") {
      setInventoryQuery("");
      setInventorySort("newest");
      setView("inventory");
      return;
    }
    if (target === "drafts") {
      setListingStateFilter("DRAFT");
      setListingSort("newest");
      setView("listings");
      return;
    }
    if (target === "watches") {
      setView("pnl");
      return;
    }
    if (target === "reprice") {
      setView("pnl");
      void checkReprices();
      return;
    }
    setView("pnl");
  }

  function startPullRefresh(event: TouchEvent<HTMLElement>) {
    if (refreshing || window.scrollY > 0) return;
    const touch = event.touches[0];
    if (!touch) return;
    pullStartY.current = touch.clientY;
    pullTracking.current = false;
  }

  function movePullRefresh(event: TouchEvent<HTMLElement>) {
    const startY = pullStartY.current;
    const touch = event.touches[0];
    if (startY == null || !touch) return;

    const deltaY = touch.clientY - startY;
    if (deltaY <= 0) {
      pullTracking.current = false;
      setPullDistance(0);
      return;
    }

    if (window.scrollY > 0 && !pullTracking.current) return;

    const distance = pullRefreshDistance(deltaY);
    if (distance > 6) pullTracking.current = true;
    setPullDistance(distance);
  }

  function finishPullRefresh() {
    const shouldRefresh = shouldTriggerPullRefresh(pullDistance) && !refreshing;
    pullStartY.current = null;
    pullTracking.current = false;
    setPullDistance(0);
    if (shouldRefresh) void refreshAll({ toast: true, user: true });
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
      setComp(payload.comps ?? { headline: payload.comp, all: [payload.comp], sourcesDisagree: false });
      if (payload.catalog?.imageUrl) setCardArtUrl(payload.catalog.imageUrl);
      setNotice(`Stocked. List at ${gbp(payload.suggestion.pricePence)}.`);
      await refreshAll();
      setView("inventory");
    } catch (err) {
      setError(err instanceof Error ? err.message : "acquire failed");
    } finally {
      setBusy(null);
    }
  }

  async function stockWithoutComp() {
    setBusy("manual-stock");
    setError(null);
    setNotice(null);
    const costBasisPence = poundsToPence(cost);
    const draftDefaults = buildListingDraftDefaults({
      card: { name, number },
      grade,
      costBasis: costBasisPence,
    });

    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card: { name, setName: setNameValue, number },
          grade,
          costBasisPence,
          acquiredFrom: source || undefined,
          location: location || undefined,
          status: "IN_STOCK",
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "manual stock failed");

      let listingCreated = false;
      if (payload.item?.id) {
        const listingRes = await fetch("/api/listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: payload.item.id,
            channel,
            state: "DRAFT",
            listPricePence: draftDefaults.listPricePence,
          }),
        });
        const listingPayload = await readJson(listingRes);
        if (!listingRes.ok) {
          console.warn("[manual stock] draft listing skipped:", listingPayload.error ?? "listing create failed");
        } else {
          listingCreated = true;
        }
      }

      setNotice(
        listingCreated
          ? `Stocked manually. Drafted at ${gbp(draftDefaults.listPricePence)}.`
          : "Stocked manually. Add a listing from Stock when ready.",
      );
      await refreshAll();
      setView("inventory");
    } catch (err) {
      setError(err instanceof Error ? err.message : "manual stock failed");
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

  function requestDeleteWatch(watch: WatchRecord) {
    setDeleteTarget({ kind: "watch", watch });
  }

  async function deleteWatch(watch: WatchRecord) {
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
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "watch delete failed");
    } finally {
      setBusy(null);
    }
  }

  function persistQuickHunts(next: QuickHuntCard[]) {
    setQuickHunts(next);
    try {
      window.localStorage.setItem(QUICK_HUNTS_STORAGE_KEY, serializeQuickHunts(next));
    } catch {
      // Local storage is a convenience; the fixed defaults still make the
      // acquire flow usable if the browser blocks persistence.
    }
  }

  function pinCurrentQuickHunt() {
    const next = pinQuickHunt(quickHunts, {
      name,
      setName: setNameValue,
      number,
      imageUrl: selectedCardImage ?? undefined,
      setMarkUrl: selectedCardMarkUrl ?? undefined,
    });
    persistQuickHunts(next);
    setNotice(`${name.trim()} pinned to quick hunts.`);
    setError(null);
  }

  function removePinnedQuickHunt(card: QuickHuntCard) {
    const next = removeQuickHunt(quickHunts, card);
    persistQuickHunts(next.length > 0 ? next : DEFAULT_QUICK_HUNTS);
    setNotice(`${card.name} removed from quick hunts.`);
    setError(null);
  }

  function resetQuickHunts() {
    persistQuickHunts(DEFAULT_QUICK_HUNTS);
    setNotice("Quick hunts reset.");
    setError(null);
  }

  function chooseQuickHunt(card: QuickHuntCard) {
    setName(card.name);
    setSetNameValue(card.setName);
    setNumber(card.number);
    setComp(null);
    setSuggestion(null);
    setCardArtUrl(card.imageUrl ?? null);
    setGradeComp(null);
    setNotice(null);
    setError(null);
  }

  async function loadSetCatalog() {
    try {
      const [popularRes, allRes] = await Promise.all([
        fetch("/api/catalog/sets"),
        fetch("/api/catalog/sets?all=1"),
      ]);
      const popularPayload = await readJson(popularRes);
      const allPayload = await readJson(allRes);
      if (popularRes.ok) setPopularSets(popularPayload.sets ?? []);
      if (allRes.ok) setAllSets(allPayload.sets ?? []);
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
    const nextChannel = item.listings[0]?.channel ?? "EBAY";
    const estimate = estimateSaleCosts(nextChannel, price);
    setSellingId(item.id);
    setEditingItemId(null);
    setCreatingListingItemId(null);
    setSalePrice(penceToPounds(price));
    setFees(penceToPounds(estimate.feesPence));
    setPostage(penceToPounds(estimate.postagePence));
    setSoldAt(todayInputValue());
    setSaleChannel(nextChannel);
    setFeesTouched(false);
    setPostageTouched(false);
  }

  function applySaleChannelPreset(nextChannel: Channel) {
    const estimate = estimateSaleCosts(nextChannel, poundsToPence(salePrice));
    setSaleChannel(nextChannel);
    setFees(penceToPounds(estimate.feesPence));
    setPostage(penceToPounds(estimate.postagePence));
    setFeesTouched(false);
    setPostageTouched(false);
  }

  function openInventoryEditor(item: InventoryItem) {
    setEditingItemId(item.id);
    setSellingId(null);
    setCreatingListingItemId(null);
    setItemQuantity(String(item.quantity));
    setItemCost(penceToPounds(item.costBasis));
    setItemSource(item.acquiredFrom ?? "");
    setItemLocation(item.location ?? "");
    setItemStatus(item.status);
    setError(null);
    setNotice(null);
  }

  async function saveInventoryItem(event: FormEvent) {
    event.preventDefault();
    const item = inventory.find((row) => row.id === editingItemId);
    if (!item) return;
    const quantity = Number(itemQuantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Quantity must be a whole number above 0.");
      return;
    }

    setBusy(`edit-${item.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/inventory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity,
          costBasisPence: poundsToPence(itemCost),
          acquiredFrom: itemSource.trim() || null,
          location: itemLocation.trim() || null,
          status: itemStatus,
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "inventory edit failed");
      setNotice(`${item.card.name} updated.`);
      setEditingItemId(null);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "inventory edit failed");
    } finally {
      setBusy(null);
    }
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
          soldAt: soldAtIso(soldAt),
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

  function applyExpensePreset(preset: (typeof expensePresets)[number]) {
    setExpenseCategory(preset.category);
    setExpenseDescription(preset.description);
    if (preset.amount) setExpenseAmount(preset.amount);
    setExpenseChannel(preset.channel ?? "");
    setError(null);
    setNotice(null);
  }

  async function addExpense(event: FormEvent) {
    event.preventDefault();
    const description = expenseDescription.trim();
    const amountPence = poundsToPence(expenseAmount);
    if (!description) {
      setError("Add a short cost description.");
      return;
    }
    if (amountPence <= 0) {
      setError("Enter a cost above £0.");
      return;
    }

    setBusy("expense-create");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: expenseCategory,
          description,
          amountPence,
          spentAt: soldAtIso(expenseSpentAt),
          channel: expenseChannel || undefined,
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "expense create failed");
      setNotice(`Cost saved: ${gbp(amountPence)}.`);
      setExpenseAmount("");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "expense create failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteExpense(expense: ExpenseRecord) {
    setBusy(`expense-${expense.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "expense delete failed");
      setNotice("Cost deleted.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "expense delete failed");
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

  function openListingCreator(item: InventoryItem) {
    const defaults = buildListingDraftDefaults({
      card: item.card,
      grade: item.grade,
      costBasis: item.costBasis,
    });
    setCreatingListingItemId(item.id);
    setEditingListingId(null);
    setSellingId(null);
    setListingPrice(penceToPounds(defaults.listPricePence));
    setListingState("DRAFT");
    setListingChannel(item.listings[0]?.channel ?? "EBAY");
    setListingExternalUrl("");
    setError(null);
    setNotice(null);
  }

  async function createListing(event: FormEvent) {
    event.preventDefault();
    const item = inventory.find((row) => row.id === creatingListingItemId);
    if (!item) return;
    setBusy(`create-listing-${item.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          channel: listingChannel,
          state: listingState === "ACTIVE" ? "ACTIVE" : "DRAFT",
          listPricePence: poundsToPence(listingPrice),
          externalUrl: listingExternalUrl.trim() || null,
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "listing create failed");
      setNotice(`${item.card.name} listing ${listingState === "ACTIVE" ? "activated" : "drafted"}.`);
      setCreatingListingItemId(null);
      await refreshAll();
      setView("listings");
      setListingStateFilter(listingState === "ACTIVE" ? "ACTIVE" : "DRAFT");
    } catch (err) {
      setError(err instanceof Error ? err.message : "listing create failed");
    } finally {
      setBusy(null);
    }
  }

  async function listInventoryItem(item: InventoryItem) {
    const listing = item.listings.find((row) => row.state !== "SOLD" && row.state !== "ENDED") ?? item.listings[0];
    if (!listing) {
      openListingCreator(item);
      return;
    }
    await patchListing(listing, { state: "ACTIVE" }, "Listing activated.");
  }

  function requestDeleteItem(item: InventoryItem) {
    setDeleteTarget({ kind: "inventory", item });
  }

  async function deleteItem(item: InventoryItem) {
    setBusy(`delete-${item.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/${item.id}`, { method: "DELETE" });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "delete failed");
      setNotice("Inventory row deleted.");
      setDeleteTarget(null);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmDeleteTarget() {
    const target = deleteTarget;
    if (!target) return;
    if (target.kind === "inventory") {
      await deleteItem(target.item);
      return;
    }
    await deleteWatch(target.watch);
  }

  function openListingEditor(listing: Listing) {
    setEditingListingId(listing.id);
    setCreatingListingItemId(null);
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
      const alertsCreated = Number(payload.alertsCreated ?? hits.length);
      setWatchMessage(
        hits.length === 0
          ? "No sourcing targets hit right now."
          : alertsCreated === 0
            ? `${hits.length} sourcing target${hits.length === 1 ? "" : "s"} still hit. No duplicate alert sent.`
            : `${hits.length} sourcing target${hits.length === 1 ? "" : "s"} hit; ${alertsCreated} new alert${alertsCreated === 1 ? "" : "s"}${payload.notified ? " sent" : ""}.`,
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

  const pullReady = shouldTriggerPullRefresh(pullDistance);
  const pullVisible = userRefreshing || pullDistance > 0;
  const pullOffset = pullVisible ? Math.round(pullRefreshProgress(pullDistance) * 16) : -64;

  return (
    <main
      className="app-shell"
      onTouchStart={startPullRefresh}
      onTouchMove={movePullRefresh}
      onTouchEnd={finishPullRefresh}
      onTouchCancel={finishPullRefresh}
    >
      <div
        className={`pull-refresh ${pullVisible ? "visible" : ""} ${pullReady ? "ready" : ""} ${userRefreshing ? "refreshing" : ""}`}
        style={{ transform: `translate(-50%, ${pullOffset}px)` }}
        aria-hidden={!pullVisible}
      >
        <span className="pull-refresh-dot" aria-hidden="true" />
        <span>{userRefreshing ? "Refreshing" : pullReady ? "Release to refresh" : "Pull to refresh"}</span>
      </div>
      <header className="topbar">
        <div className="brand-lockup">
          {spotlightImage ? (
            <CardImage src={spotlightImage} className="app-mark app-mark-image" fallbackClassName="app-mark" alt="" />
          ) : (
            <span className="app-mark" aria-hidden="true" />
          )}
          <div>
            <p className="eyebrow">Pokémon Dealer OS</p>
            <h1>{viewTitle(view)}</h1>
          </div>
          {selectedCardMarkUrl && (
            <img
              className="brand-set-logo"
              src={selectedCardMarkUrl}
              alt={`${selectedSet?.name ?? catalogCard?.setName ?? setNameValue} set logo`}
              onError={hideBrokenImage}
            />
          )}
        </div>
        <button
          className={`icon-button ${refreshing ? "is-loading" : ""}`}
          type="button"
          onClick={() => void refreshAll({ toast: true, user: true })}
          disabled={refreshing}
          aria-label={refreshing ? "Refreshing data" : "Refresh data"}
        >
          <span className="refresh-icon" aria-hidden="true">
            ↻
          </span>
        </button>
      </header>

      <section className="hero-board" aria-label="Dealer command board">
        <div className="hero-copy">
          <p className="eyebrow">Card fair mode</p>
          <strong>{chaseLine}</strong>
          <span>GBP comps, stock, listings and profit in one pocket.</span>
        </div>
        <div className="hero-card-art" aria-hidden="true">
          <CardImage src={spotlightImage} fallbackClassName="card-back" alt="" />
          {selectedCardMarkUrl && <img className="set-mark" src={selectedCardMarkUrl} alt="" onError={hideBrokenImage} />}
        </div>
      </section>

      <section className="status-strip" aria-label="Business summary">
        <Metric label="Stock" value={String(dashboard?.metrics.stockCount ?? 0)} loading={dashboardLoading} />
        <Metric label="Listed" value={String(dashboard?.metrics.listedCount ?? 0)} loading={dashboardLoading} />
        <Metric
          label="Profit"
          value={gbp(dashboard?.metrics.realizedProfitPence ?? 0)}
          tone="good"
          loading={dashboardLoading}
        />
      </section>

      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {notice && <Toast tone="success" message={notice} onDismiss={() => setNotice(null)} />}
        {error && <Toast tone="danger" message={error} onDismiss={() => setError(null)} />}
      </div>

      {view === "today" && (
        <section className="workspace today-workspace">
          <section className="panel today-panel">
            <div className="panel-heading">
              <div>
                <h2>Today</h2>
                <span className="muted">{todayActions.length} action{todayActions.length === 1 ? "" : "s"}</span>
              </div>
              <button className="ghost-button" type="button" onClick={() => setView("acquire")}>
                New buy
              </button>
            </div>
            <div className="today-action-list">
              {todayActions.map((action) => (
                <TodayActionButton key={action.id} action={action} onOpen={openTodayAction} />
              ))}
            </div>
          </section>

          <section className="panel setup-panel">
            <div className="panel-heading">
              <div>
                <h2>Setup</h2>
                <span className="muted">{systemStatus?.summary.livePrimaryComps ? "live comps" : "fixture comps"}</span>
              </div>
              <span className={`pill ${systemStatus?.summary.secondaryCrossCheck ? "good" : "warn"}`}>
                {systemStatus?.summary.secondaryCrossCheck ? "cross-check" : "single source"}
              </span>
            </div>
            <div className="source-health-list">
              {(systemStatus?.sources ?? []).map((source) => (
                <SourceHealthRow key={source.id} source={source} />
              ))}
            </div>
          </section>

          <section className="panel launch-panel">
            <div className="panel-heading">
              <h2>Launch board</h2>
              <span className="muted">side-hustle basics</span>
            </div>
            <div className="setup-step-list">
              <SetupStep
                done={(dashboard?.metrics.stockCount ?? 0) > 0}
                title="Stock ledger"
                detail={`${dashboard?.metrics.stockCount ?? 0} stocked`}
                action="Buy"
                onClick={() => setView("acquire")}
              />
              <SetupStep
                done={listings.length > 0}
                title="Listing pipeline"
                detail={`${draftListingCount} draft / ${activeListingCount} active`}
                action="Listings"
                onClick={() => setView("listings")}
              />
              <SetupStep
                done={(dashboard?.metrics.soldCount ?? 0) > 0}
                title="Booked sales"
                detail={`${dashboard?.metrics.soldCount ?? 0} sold`}
                action="Stock"
                onClick={() => setView("inventory")}
              />
              <SetupStep
                done={activeWatchCount > 0}
                title="Sourcing targets"
                detail={`${activeWatchCount} active`}
                action="Targets"
                onClick={() => setView("pnl")}
              />
              <SetupStep
                done={(dashboard?.metrics.operatingExpensePence ?? 0) > 0}
                title="Cost tracker"
                detail={gbp(dashboard?.metrics.operatingExpensePence ?? 0)}
                action="Costs"
                onClick={() => setView("pnl")}
              />
            </div>
          </section>

          <section className="panel quick-command-panel">
            <div className="panel-heading">
              <h2>Commands</h2>
              <span className="muted">daily tools</span>
            </div>
            <div className="command-grid">
              <button type="button" onClick={() => setView("acquire")}>Comp buy</button>
              <button type="button" onClick={() => setView("inventory")}>Sell stock</button>
              <button type="button" onClick={() => setView("listings")}>List drafts</button>
              <button type="button" onClick={() => setView("pnl")}>Profit</button>
              <button type="button" onClick={() => setView("pnl")}>Add cost</button>
              <a className="export-link" href="/api/export/books" download>Books CSV</a>
              <a className="export-link" href="/api/export/listings?state=DRAFT" download>Draft CSV</a>
            </div>
          </section>
        </section>
      )}

      {view === "acquire" && (
        <section className="workspace">
          <form className="panel lookup-panel" onSubmit={lookup}>
            <div className="panel-heading">
              <h2>Fast comp</h2>
              <span className="muted">Live GBP valuation</span>
            </div>
            <div className="selected-card-strip" aria-label="Selected card">
              <CardImage
                src={selectedCardImage}
                className="selected-card-art"
                fallbackClassName="selected-card-art blank"
                alt={`${name} card art`}
              />
              <div>
                <span>Current card</span>
                <strong>{name}</strong>
                <small>
                  {setNameValue}
                  {number ? ` #${number}` : ""}
                  {" · "}
                  {grade.replace(/_/g, " ")}
                </small>
              </div>
              {selectedCardMarkUrl && (
                <img
                  className="selected-set-mark"
                  src={selectedCardMarkUrl}
                  alt={`${selectedSet?.name ?? catalogCard?.setName ?? setNameValue} set logo`}
                  onError={hideBrokenImage}
                />
              )}
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
                      {card.imageUrl ? (
                        <CardImage src={card.imageUrl} className="suggestion-card-art" fallbackClassName="suggestion-card-art blank" alt="" />
                      ) : null}
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
                  placeholder="base set, evo skies, PRE..."
                  autoComplete="off"
                />
                {setSuggestionsOpen && setSuggestions.length > 0 && (
                  <div className="set-suggestions" role="listbox" aria-label="Set suggestions">
                    {setSuggestions.map((set) => (
                      <button key={set.id} type="button" className="suggestion-item" onClick={() => chooseSet(set)}>
                        {set.symbolUrl ? <img src={set.symbolUrl} alt="" onError={hideBrokenImage} /> : null}
                        <span>{set.name}</span>
                        <small>{setMetaLabel(set)}</small>
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
                    {set.logoUrl || set.symbolUrl ? (
                      <img src={set.logoUrl ?? set.symbolUrl} alt="" onError={hideBrokenImage} />
                    ) : null}
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
            {!headline && (
              <>
                <div className="quick-hunt-toolbar" aria-label="Quick hunt controls">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={pinCurrentQuickHunt}
                    disabled={!name.trim() || !setNameValue.trim() || !number.trim()}
                  >
                    Pin current
                  </button>
                  <button className="ghost-button" type="button" onClick={resetQuickHunts}>
                    Reset
                  </button>
                </div>
                <div className="quick-hunts" aria-label="Quick card picks">
                  {quickHunts.map((card) => (
                    <article className="quick-hunt-card" key={`${card.name}-${card.setName}-${card.number}`}>
                      <button className="quick-hunt-pick" type="button" onClick={() => chooseQuickHunt(card)}>
                        <span className="quick-art-stack">
                          <CardImage src={card.imageUrl} className="quick-card-art" fallbackClassName="quick-card-art blank" alt="" />
                          {card.setMarkUrl && (
                            <img className="quick-set-mark" src={card.setMarkUrl} alt="" onError={hideBrokenImage} />
                          )}
                        </span>
                        <span>{card.name}</span>
                      </button>
                      <button
                        className="quick-hunt-remove danger-button"
                        type="button"
                        onClick={() => removePinnedQuickHunt(card)}
                        aria-label={`Remove ${card.name} quick hunt`}
                      >
                        x
                      </button>
                    </article>
                  ))}
                </div>
              </>
            )}
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
              {deal && (
                <div className={`deal-banner ${deal.tone}`}>
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
                  <CardImage
                    src={catalogCard.imageUrl ?? null}
                    className="catalog-art"
                    fallbackClassName="catalog-art blank"
                    alt={`${catalogCard.name} card art`}
                  />
                  <div>
                    <span>TCG catalog</span>
                    <strong>{catalogCard.name}</strong>
                    <small>
                      {catalogCard.setName}
                      {catalogCard.number ? ` #${catalogCard.number}` : ""}
                    </small>
                  </div>
                  {setMarkUrl && (
                    <img
                      className="catalog-set-logo"
                      src={setMarkUrl}
                      alt={`${catalogCard.setName} logo`}
                      onError={hideBrokenImage}
                    />
                  )}
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
                  Using a catalog market baseline because raw sold data is thin, missing, or materially above market.
                  {headline.raw.caveat ? ` ${headline.raw.caveat}` : ""}
                </p>
              )}
              {comp?.sourcesDisagree && (
                <p className="hint danger-text">Sources disagree materially. Treat this as a check-before-buy price.</p>
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
                  Grade cost
                  <MoneyInput value={gradingCost} onChange={setGradingCost} />
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
                  Target
                  <MoneyInput value={watchTarget} onChange={setWatchTarget} />
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
                Cost
                <MoneyInput value={cost} onChange={setCost} />
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
            <div className="preset-row" aria-label="Source presets">
              {sourcePresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={source === preset ? "selected" : ""}
                  onClick={() => setSource(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="preset-row" aria-label="Location presets">
              {locationPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={location === preset ? "selected" : ""}
                  onClick={() => setLocation(preset)}
                >
                  {preset}
                </button>
              ))}
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
            <button className="secondary-action" type="button" onClick={stockWithoutComp} disabled={busy === "manual-stock"}>
              {busy === "manual-stock" ? "Stocking..." : "Stock now, price later"}
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
              onEdit={openInventoryEditor}
              onSell={openSell}
              onList={listInventoryItem}
              onStatus={updateStatus}
              onDelete={requestDeleteItem}
            />
          ))}
          {activeInventory.length === 0 ? (
            <EmptyState text="No active stock. Add your next buy from Buy." />
          ) : visibleActiveInventory.length === 0 ? (
            <EmptyState text="No matching active stock. Clear the search or change the sort." />
          ) : null}

          {editingItemId && (
            <form className="sell-sheet" onSubmit={saveInventoryItem}>
              <div className="panel-heading">
                <h2>Edit stock</h2>
                <button className="ghost-button" type="button" onClick={() => setEditingItemId(null)}>Close</button>
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

          {sellingId && (
            <form className="sell-sheet" onSubmit={markSold}>
              <div className="panel-heading">
                <div>
                  <h2>Mark sold</h2>
                  {sellingItem && (
                    <span className="muted">
                      {sellingItem.card.name} · cost {gbp(sellingItem.costBasis)}
                      {sellingItem.quantity > 1 ? ` · selling 1 of ${sellingItem.quantity}` : ""}
                    </span>
                  )}
                </div>
                <button className="ghost-button" type="button" onClick={() => setSellingId(null)}>Close</button>
              </div>
              <div className="sale-channel-presets" aria-label="Sale channel presets">
                {channels.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={saleChannel === c ? "selected" : ""}
                    onClick={() => applySaleChannelPreset(c)}
                  >
                    {channelLabel(c)}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <label>
                  Sale
                  <MoneyInput value={salePrice} onChange={setSalePrice} />
                </label>
                <label>
                  Sold
                  <input type="date" value={soldAt} onChange={(event) => setSoldAt(event.target.value)} />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Fees
                  <MoneyInput
                    value={fees}
                    onChange={(value) => {
                      setFeesTouched(true);
                      setFees(value);
                    }}
                  />
                </label>
                <label>
                  Postage
                  <MoneyInput
                    value={postage}
                    onChange={(value) => {
                      setPostageTouched(true);
                      setPostage(value);
                    }}
                  />
                </label>
              </div>
              {salePreview && (
                <div className={`sale-preview ${salePreview.profitPence >= 0 ? "good" : "warn"}`}>
                  <div>
                    <span>Net</span>
                    <strong>{gbp(salePreview.netPence)}</strong>
                  </div>
                  <div>
                    <span>Profit</span>
                    <strong>{gbp(salePreview.profitPence)}</strong>
                  </div>
                </div>
              )}
              <button className="primary-action" type="submit" disabled={busy === `sell-${sellingId}`}>
                {busy === `sell-${sellingId}` ? "Saving..." : "Create sale"}
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
                <button className="ghost-button" type="button" onClick={() => setCreatingListingItemId(null)}>Close</button>
              </div>
              <div className="form-grid">
                <label>
                  List price
                  <MoneyInput value={listingPrice} onChange={setListingPrice} />
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
                  onEdit={openInventoryEditor}
                  onSell={openSell}
                  onList={listInventoryItem}
                  onStatus={updateStatus}
                  onDelete={requestDeleteItem}
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
            <EmptyState text="No listings yet. Buy can create draft listings automatically." />
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
                  List price
                  <MoneyInput value={listingPrice} onChange={setListingPrice} />
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
          <section className={`pnl-summary ${noBookedSales ? "empty" : ""}`}>
            <div className="detail-grid">
              <Metric
                label="Revenue"
                value={gbp(dashboard?.metrics.realizedRevenuePence ?? 0)}
                loading={dashboardLoading}
              />
              <Metric
                label="Profit"
                value={gbp(dashboard?.metrics.realizedProfitPence ?? 0)}
                tone="good"
                loading={dashboardLoading}
              />
              <Metric
                label="Costs"
                value={gbp(dashboard?.metrics.operatingExpensePence ?? 0)}
                tone="warn"
                loading={dashboardLoading}
              />
              <Metric
                label="Net"
                value={gbp(netProfitPence)}
                tone={netProfitTone}
                loading={dashboardLoading}
              />
              <Metric
                label="Margin"
                value={dashboard?.metrics.realizedMarginPct == null ? "n/a" : `${dashboard.metrics.realizedMarginPct}%`}
                loading={dashboardLoading}
              />
              <Metric
                label="Sell-through"
                value={`${dashboard?.metrics.sellThroughPct ?? 0}%`}
                loading={dashboardLoading}
              />
            </div>
            {noBookedSales ? (
              <div className="pnl-empty-note">
                <strong>Nothing booked yet</strong>
                <span>Mark a stocked card sold from Stock, then add any setup costs here so net profit stays honest.</span>
              </div>
            ) : profitTrend.length > 0 ? (
              <ProfitSparkline points={profitTrend} />
            ) : null}
          </section>
          <div className="export-actions" aria-label="Books export">
            <a className="export-link" href="/api/export/books" download>
              Sales CSV
            </a>
            <a className="export-link" href="/api/export/expenses" download>
              Costs CSV
            </a>
          </div>
          <section className="panel expense-panel">
            <div className="panel-heading">
              <div>
                <h2>Costs</h2>
                <span className="muted">{expenses.length} saved</span>
              </div>
              <strong>{gbp(dashboard?.metrics.operatingExpensePence ?? 0)}</strong>
            </div>
            <form className="expense-form" onSubmit={addExpense}>
              <div className="preset-row expense-presets" aria-label="Cost presets">
                {expensePresets.map((preset) => (
                  <button
                    key={`${preset.category}-${preset.description}`}
                    type="button"
                    onClick={() => applyExpensePreset(preset)}
                  >
                    {expenseCategoryLabel(preset.category)}
                  </button>
                ))}
              </div>
              <label>
                Description
                <input
                  value={expenseDescription}
                  onChange={(event) => setExpenseDescription(event.target.value)}
                  placeholder="Toploaders, table fee, grading..."
                />
              </label>
              <div className="form-grid">
                <label>
                  Amount
                  <MoneyInput value={expenseAmount} onChange={setExpenseAmount} />
                </label>
                <label>
                  Date
                  <input type="date" value={expenseSpentAt} onChange={(event) => setExpenseSpentAt(event.target.value)} />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Category
                  <select value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value as ExpenseCategory)}>
                    {expenseCategories.map((category) => (
                      <option key={category} value={category}>{expenseCategoryLabel(category)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Channel
                  <select value={expenseChannel} onChange={(event) => setExpenseChannel(event.target.value as Channel | "")}>
                    <option value="">general</option>
                    {channels.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
                  </select>
                </label>
              </div>
              <button className="primary-action" type="submit" disabled={busy === "expense-create"}>
                {busy === "expense-create" ? "Saving..." : "Add cost"}
              </button>
            </form>
            <div className="expense-list">
              {expenses.slice(0, 6).map((expense) => (
                <article className="expense-row" key={expense.id}>
                  <div>
                    <strong>{expense.description}</strong>
                    <span>
                      {expenseCategoryLabel(expense.category)}
                      {expense.channel ? ` · ${channelLabel(expense.channel)}` : ""}
                      {" · "}
                      {shortDate(expense.spentAt)}
                    </span>
                  </div>
                  <div>
                    <strong>{gbp(expense.amount)}</strong>
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => void deleteExpense(expense)}
                      disabled={busy === `expense-${expense.id}`}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
              {expenses.length === 0 && <EmptyState text="No costs saved yet. Add setup costs, supplies, grading and fair fees here." />}
            </div>
          </section>
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
                    onDelete={() => requestDeleteWatch(watch)}
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
              <EmptyState text="No sales booked yet. Mark an item sold from Stock." />
            )}
          </section>
        </section>
      )}

      {deleteTarget && (
        <section className="confirm-sheet" role="dialog" aria-modal="true" aria-label="Confirm delete">
          <div>
            <p className="eyebrow">Delete</p>
            <h2>{deleteTarget.kind === "inventory" ? deleteTarget.item.card.name : deleteTarget.watch.card.name}</h2>
            <span>
              {deleteTarget.kind === "inventory"
                ? `${deleteTarget.item.grade.replace(/_/g, " ")} stock row, listing drafts and sale records will be removed.`
                : `${deleteTarget.watch.grade.replace(/_/g, " ")} buy watch and its alerts will be removed.`}
            </span>
          </div>
          <div className="confirm-actions">
            <button className="ghost-button" type="button" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={confirmDeleteTarget}
              disabled={
                deleteTarget.kind === "inventory"
                  ? busy === `delete-${deleteTarget.item.id}`
                  : busy === `watch-${deleteTarget.watch.id}`
              }
            >
              {busy?.startsWith("delete-") || busy?.startsWith("watch-") ? "Deleting..." : "Delete"}
            </button>
          </div>
        </section>
      )}

      <nav className="bottom-nav" aria-label="Primary">
        <TabButton active={view === "today"} label="Today" onClick={() => setView("today")} />
        <TabButton active={view === "acquire"} label="Buy" onClick={() => setView("acquire")} />
        <TabButton active={view === "inventory"} label="Stock" onClick={() => setView("inventory")} />
        <TabButton active={view === "listings"} label="List" onClick={() => setView("listings")} />
        <TabButton active={view === "pnl"} label="Profit" onClick={() => setView("pnl")} />
      </nav>
    </main>
  );
}

function InventoryRow({
  item,
  busy,
  onEdit,
  onSell,
  onList,
  onStatus,
  onDelete,
}: {
  item: InventoryItem;
  busy: string | null;
  onEdit: (item: InventoryItem) => void;
  onSell: (item: InventoryItem) => void;
  onList: (item: InventoryItem) => void;
  onStatus: (item: InventoryItem, status: ItemStatus) => void;
  onDelete: (item: InventoryItem) => void;
}) {
  const listing = item.listings[0];
  const sale = item.sales[0];
  const listingStateLabel = listing ? listing.state.charAt(0) + listing.state.slice(1).toLowerCase() : "";
  const soldNote =
    item.sales.length === 0
      ? ""
      : item.status === "SOLD" && sale
        ? ` · sold ${gbp(sale.salePrice)}`
        : ` · ${item.sales.length} sold`;
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipeDelta = useRef({ x: 0, y: 0 });
  const canSell = item.status !== "SOLD";

  function startSwipe(event: TouchEvent<HTMLElement>) {
    if (isInteractiveTarget(event.target)) return;
    const touch = event.touches[0];
    if (!touch) return;
    swipeStart.current = { x: touch.clientX, y: touch.clientY };
    swipeDelta.current = { x: 0, y: 0 };
  }

  function moveSwipe(event: TouchEvent<HTMLElement>) {
    const start = swipeStart.current;
    const touch = event.touches[0];
    if (!start || !touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const offset = inventorySwipeOffset(deltaX, deltaY);
    swipeDelta.current = { x: deltaX, y: deltaY };
    setSwipeOffset(offset);

    if (offset !== 0) {
      setIsSwiping(true);
      event.stopPropagation();
    }
  }

  function finishSwipe(event: TouchEvent<HTMLElement>) {
    const action = inventorySwipeAction(swipeDelta.current.x, swipeDelta.current.y, { canSell });
    const wasSwiping = isSwiping;
    swipeStart.current = null;
    swipeDelta.current = { x: 0, y: 0 };
    setSwipeOffset(0);
    setIsSwiping(false);

    if (wasSwiping) event.stopPropagation();
    if (action === "sell") onSell(item);
    if (action === "delete") onDelete(item);
  }

  return (
    <article
      className={`item-row swipe-row ${isSwiping ? "is-swiping" : ""}`}
      onTouchStart={startSwipe}
      onTouchMove={moveSwipe}
      onTouchEnd={finishSwipe}
      onTouchCancel={finishSwipe}
    >
      <div className="swipe-actions-bg" aria-hidden="true">
        <span className={`swipe-action sell ${canSell ? "" : "disabled"}`}>Sell</span>
        <span className="swipe-action delete">Delete</span>
      </div>
      <div className="swipe-content" style={{ transform: `translateX(${swipeOffset}px)` }}>
        <CardImage src={item.card.imageUrl} className="card-thumb" fallbackClassName="card-thumb blank" alt="" />
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
          <p>
            {listing ? `${listingStateLabel} ${channelLabel(listing.channel)} at ${gbp(listing.listPrice ?? listing.suggestedPrice ?? 0)}` : "No listing"}
            {soldNote}
          </p>
          <div className="row-actions">
            {item.status !== "SOLD" && (
              <button type="button" onClick={() => onEdit(item)} disabled={busy === `edit-${item.id}`}>
                Edit
              </button>
            )}
            {item.status !== "SOLD" && (
              <button type="button" onClick={() => onSell(item)} disabled={busy?.startsWith("sell-")}>
                Sell
              </button>
            )}
            {item.status === "IN_STOCK" && (
              <button
                type="button"
                onClick={() => onList(item)}
                disabled={busy === `status-${item.id}` || busy?.startsWith("listing-") || busy?.startsWith("create-listing-")}
              >
                {listing ? "Activate" : "Draft"}
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
      <CardImage src={card?.imageUrl ?? null} className="card-thumb" fallbackClassName="card-thumb blank" alt="" />
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

function TodayActionButton({
  action,
  onOpen,
}: {
  action: TodayAction;
  onOpen: (target: TodayActionTarget) => void;
}) {
  return (
    <button className={`today-action ${action.tone}`} type="button" onClick={() => onOpen(action.target)}>
      <span>
        <strong>{action.title}</strong>
        <small>{action.detail}</small>
      </span>
      <b aria-hidden="true">›</b>
    </button>
  );
}

function SourceHealthRow({ source }: { source: SystemSource }) {
  return (
    <div className={`source-health-row ${sourceStatusTone(source.status)}`}>
      <div>
        <strong>{source.label}</strong>
        <span>{source.role}</span>
      </div>
      <span>{sourceStatusLabel(source.status)}</span>
    </div>
  );
}

function SetupStep({
  done,
  title,
  detail,
  action,
  onClick,
}: {
  done: boolean;
  title: string;
  detail: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className={`setup-step ${done ? "done" : ""}`}>
      <span aria-hidden="true">{done ? "✓" : ""}</span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      <button type="button" onClick={onClick}>{action}</button>
    </div>
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
      <CardImage src={watch.card.imageUrl} className="watch-card-art" fallbackClassName="watch-card-art blank" alt="" />
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
            Target
            <MoneyInput value={editValue} onChange={onEditValue} disabled={busy} />
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

function Toast({
  tone,
  message,
  onDismiss,
}: {
  tone: "success" | "danger";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className={`notice ${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span>{message}</span>
      <button className="toast-close" type="button" onClick={onDismiss} aria-label="Dismiss message">
        ×
      </button>
    </div>
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("button, input, select, textarea, a") != null;
}

function Metric({
  label,
  value,
  tone,
  loading = false,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
  loading?: boolean;
}) {
  return (
    <div className={`metric ${tone ?? ""} ${loading ? "loading" : ""}`} aria-busy={loading ? "true" : undefined}>
      <span>{label}</span>
      <strong>{loading ? <i aria-hidden="true" /> : value}</strong>
    </div>
  );
}

function ProfitSparkline({ points }: { points: ProfitTrendPoint[] }) {
  const width = 240;
  const height = 72;
  const padding = 8;
  const coords = sparklineCoords(points, width, height, padding);
  const path =
    coords.length === 1
      ? `M ${padding} ${coords[0]?.y ?? height / 2} L ${width - padding} ${coords[0]?.y ?? height / 2}`
      : coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const latest = points.at(-1);
  const first = points[0];
  const zeroY = sparklineY(0, points, height, padding);

  return (
    <div className="profit-sparkline">
      <div>
        <span>Profit trend</span>
        <strong>{latest ? gbp(latest.cumulativeProfitPence) : "n/a"}</strong>
        {first && latest && <small>{shortDate(first.date)} to {shortDate(latest.date)}</small>}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cumulative profit trend">
        <path className="zero-line" d={`M ${padding} ${zeroY} L ${width - padding} ${zeroY}`} />
        <path className="spark-area" d={`${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`} />
        <path className="spark-line" d={path} />
        {coords.map((point) => (
          <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="3" />
        ))}
      </svg>
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

function MoneyInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className="money-input">
      <span aria-hidden="true">£</span>
      <input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
    </span>
  );
}

function CardImage({
  src,
  alt,
  className,
  fallbackClassName,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackClassName: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <span className={fallbackClassName} aria-hidden="true" />;
  return <img className={className} src={src} alt={alt} onError={() => setFailedSrc(src)} />;
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

function hideBrokenImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true;
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
    return { label: "Buy", tone: "good", expectedProfitPence, targetBuyPence };
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

function sparklineCoords(
  points: ProfitTrendPoint[],
  width: number,
  height: number,
  padding: number,
): Array<{ x: number; y: number }> {
  const drawableWidth = width - padding * 2;
  return points.map((point, index) => ({
    x: points.length === 1 ? width - padding : padding + (drawableWidth * index) / (points.length - 1),
    y: sparklineY(point.cumulativeProfitPence, points, height, padding),
  }));
}

function sparklineY(value: number, points: ProfitTrendPoint[], height: number, padding: number): number {
  const values = points.flatMap((point) => [point.cumulativeProfitPence, 0]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const drawableHeight = height - padding * 2;
  return padding + ((max - value) / span) * drawableHeight;
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
  if (view === "today") return "Today";
  if (view === "acquire") return "Buy cards";
  if (view === "inventory") return "Stock";
  if (view === "listings") return "Listings";
  return "Profit";
}

function sourceStatusLabel(status: SystemSource["status"]): string {
  if (status === "ready") return "ready";
  if (status === "public") return "public";
  if (status === "fixture") return "fixture";
  if (status === "building") return "building";
  return "missing";
}

function sourceStatusTone(status: SystemSource["status"]): string {
  if (status === "ready" || status === "building") return "good";
  if (status === "public") return "info";
  if (status === "fixture") return "warn";
  return "danger";
}

function channelLabel(channel: Channel): string {
  if (channel === "EBAY") return "eBay";
  if (channel === "CARDMARKET") return "Cardmarket";
  if (channel === "VINTED") return "Vinted";
  return "In person";
}

function expenseCategoryLabel(category: ExpenseCategory): string {
  if (category === "SUPPLIES") return "Supplies";
  if (category === "POSTAGE") return "Postage";
  if (category === "GRADING") return "Grading";
  if (category === "TABLE_FEE") return "Table fee";
  if (category === "TRAVEL") return "Travel";
  if (category === "PLATFORM") return "Platform";
  return "Other";
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function todayInputValue(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function soldAtIso(value: string): string | undefined {
  return value ? `${value}T12:00:00.000Z` : undefined;
}

function setMetaLabel(set: CatalogSet): string {
  const year = set.releaseDate?.slice(0, 4);
  return [set.ptcgoCode, year].filter(Boolean).join(" · ") || set.series || "set";
}

function buildDefaultSetSuggestions(popularSets: CatalogSet[], allSets: CatalogSet[], limit = 48): CatalogSet[] {
  const seen = new Set<string>();
  const merged: CatalogSet[] = [];
  for (const set of [...popularSets, ...allSets]) {
    if (seen.has(set.id)) continue;
    seen.add(set.id);
    merged.push(set);
    if (merged.length >= limit) break;
  }
  return merged;
}

function findSelectedSet(sets: CatalogSet[], value: string): CatalogSet | null {
  const query = value.trim().toLowerCase();
  if (!query) return null;
  return (
    sets.find((set) => set.id.toLowerCase() === query || set.name.toLowerCase() === query || set.ptcgoCode?.toLowerCase() === query) ??
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
