"use client";

import { type FormEvent, type SyntheticEvent, type TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  conditionAdjustedPricePence,
  rawConditionPriceFactor,
  suggestListPrice,
  type PricingStrategy,
} from "@/lib/comps/pricing";
import type { CompResult as DomainCompResult, Grade as DomainGrade } from "@/lib/domain/types";
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
import { parseRecentSetIds, pinRecentSetId } from "@/lib/dealer/recentSets";
import { buildDealerCompVerdict } from "@/lib/dealer/compVerdict";
import { buildManualCompLinks, cardSearchQuery, normalizeManualCompSearchText } from "@/lib/dealer/compLinks";
import { buildListingDraftDefaults } from "@/lib/dealer/listingDraft";
import { buildLaunchReadiness, type LaunchReadinessItem, type LaunchReadinessTarget } from "@/lib/dealer/launchReadiness";
import { buildLaunchPlan, type LaunchPlanItem, type LaunchPlanTarget } from "@/lib/dealer/launchPlan";
import { buildBuyPlan, buildBuyTargetSuggestion } from "@/lib/dealer/buyPlan";
import { buildCheckedComp, checkedCompSourceLabel, type CheckedCompSource } from "@/lib/dealer/checkedComp";
import {
  buildListingPack,
  listingPackCopyFields,
  type ListingPack,
  type ListingPackCopyField,
} from "@/lib/dealer/listingPack";
import { listingVenueAction, nextDraftListingId } from "@/lib/dealer/listingWorkflow";
import { parseQuickIntake } from "@/lib/dealer/intakeParser";
import { parseStockImportText } from "@/lib/dealer/stockImport";
import { nextIntakeFormAfterStock, parseIntakeQuantity } from "@/lib/dealer/intakeSession";
import { pullRefreshDistance, pullRefreshProgress, shouldTriggerPullRefresh } from "@/lib/dealer/pullRefresh";
import {
  buyerPaidPostagePence,
  breakEvenSalePricePence,
  defaultGrossSalePence,
  estimateSaleCosts,
  saleNetPence,
} from "@/lib/dealer/saleFees";
import { inventorySwipeAction, inventorySwipeOffset } from "@/lib/dealer/swipeActions";
import { buildTodayActions, type TodayAction, type TodayActionTarget } from "@/lib/dealer/today";

type View = "today" | "acquire" | "inventory" | "listings" | "pnl";
type Grade = DomainGrade;
type PsaCertView = {
  found: boolean;
  certNumber: string;
  subject?: string;
  brand?: string;
  year?: string;
  cardNumber?: string;
  variety?: string;
  gradeLabel?: string;
  grade: Grade | null;
  totalPopulation?: number;
  populationHigher?: number;
  live: boolean;
  reason?: string;
};
type Channel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
type AcquireListingState = "DRAFT" | "ACTIVE";
type ItemStatus = "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
type ListingState = "DRAFT" | "ACTIVE" | "SOLD" | "ENDED";
type ExpenseCategory = "SUPPLIES" | "POSTAGE" | "GRADING" | "TABLE_FEE" | "TRAVEL" | "PLATFORM" | "OTHER";
type BuyFlowState = "done" | "current" | "wait" | "warn";
type BuyFlowStep = {
  label: string;
  detail: string;
  state: BuyFlowState;
};
type LookupInput = {
  name: string;
  setName: string;
  number: string;
  grade: Grade;
};

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

type CompResult = Omit<DomainCompResult, "raw"> & {
  raw?: {
    smartMarketPrice?: { confidence?: string; daysUsed?: number; method?: string };
    chosenPriceSource?: string;
    kind?: string;
    caveat?: string;
    chosenSignal?: CatalogPriceSignal;
    reason?: string;
    priceSource?: string;
    market?: string;
    tier?: string;
    sales?: OwnedSaleCompRow[];
    source?: CheckedCompSource;
    sourceLabel?: string;
    note?: string;
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
  condition: string | null;
  graderCert: string | null;
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
    soldCostPence: number;
    realizedRevenuePence: number;
    realizedFeesPence: number;
    realizedPostagePence: number;
    realizedProfitPence: number;
    operatingExpensePence: number;
    netProfitPence: number;
    cashInPence: number;
    cashOutPence: number;
    cashNetPence: number;
    cashRecoveryPct: number;
    realizedMarginPct: number | null;
    sellThroughPct: number;
    averageAgeDays: number;
    agedStockCount: number;
    channelBreakdown: ChannelBreakdown[];
    bestSale: SaleSummary | null;
    worstSale: SaleSummary | null;
  };
  recentSales: SaleSummary[];
  recentExpenses: ExpenseRecord[];
  staleStock: Array<{ id: string; name: string; grade: string; status: ItemStatus; createdAt: string }>;
  listingsByState: Record<string, number>;
};

type ChannelBreakdown = {
  channel: Channel;
  saleCount: number;
  revenuePence: number;
  feesPence: number;
  postagePence: number;
  costPence: number;
  profitPence: number;
  averageSalePence: number;
  averageProfitPence: number;
  marginPct: number | null;
};

type SaleSummary = {
  id: string;
  itemId: string;
  name: string;
  grade: string;
  channel: Channel;
  salePricePence: number;
  feesPence: number;
  postagePence: number;
  costBasisPence: number;
  profitPence: number;
  marginPct: number | null;
  soldAt: string;
};

type DeleteTarget =
  | { kind: "inventory"; item: InventoryItem }
  | { kind: "watch"; watch: WatchRecord }
  | { kind: "sale"; sale: SaleSummary };

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
  setupHint?: string;
};

const quickGrades: Grade[] = ["RAW", "PSA_8", "PSA_9", "PSA_10", "ACE_9", "ACE_10", "BGS_9_5", "CGC_10"];
const gradeOptions: Grade[] = [
  "RAW",
  "PSA_1", "PSA_2", "PSA_3", "PSA_4", "PSA_5",
  "PSA_6", "PSA_7", "PSA_8", "PSA_9", "PSA_10",
  "BGS_9", "BGS_9_5", "BGS_10",
  "CGC_9", "CGC_9_5", "CGC_10",
  "ACE_9", "ACE_10",
];
const channels: Channel[] = ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"];
const checkedCompSources: CheckedCompSource[] = ["EBAY_SOLD", "CARDMARKET", "TCGPLAYER", "OTHER"];
const expenseCategories: ExpenseCategory[] = ["SUPPLIES", "POSTAGE", "GRADING", "TABLE_FEE", "TRAVEL", "PLATFORM", "OTHER"];
const editableStatuses: ItemStatus[] = ["IN_STOCK", "LISTED", "RESERVED"];
const QUICK_HUNTS_STORAGE_KEY = "pokemon-dealer-os.quick-hunts.v1";
const RECENT_SETS_STORAGE_KEY = "pokemon-dealer-os.recent-sets.v1";
const sourcePresets = ["Card fair", "Facebook", "eBay", "Cardmarket", "Vinted", "Whatnot", "Collection", "Trade-in"];
const locationPresets = ["Box A", "Box B", "Binder", "To list", "Slabs", "Singles"];
const conditionPresets = ["NM", "LP", "MP", "HP", "DMG"];
const VISIBLE_POPULAR_SET_LIMIT = 30;
const VISIBLE_QUICK_HUNT_LIMIT = 6;
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
  const [quickIntake, setQuickIntake] = useState("");
  const [manualCompQuery, setManualCompQuery] = useState("");
  const [stockImportText, setStockImportText] = useState("");
  const [grade, setGrade] = useState<Grade>("RAW");
  const [cost, setCost] = useState("18.00");
  const [quantity, setQuantity] = useState("1");
  const [source, setSource] = useState("Card fair");
  const [location, setLocation] = useState("Box A");
  const [condition, setCondition] = useState("NM");
  const [graderCert, setGraderCert] = useState("");
  const [psaResult, setPsaResult] = useState<PsaCertView | null>(null);
  const [strategy, setStrategy] = useState<PricingStrategy>("market");
  const [channel, setChannel] = useState<Channel>("EBAY");
  const [listPriceOverride, setListPriceOverride] = useState("");
  const [checkedCompPrice, setCheckedCompPrice] = useState("");
  const [checkedCompSample, setCheckedCompSample] = useState("1");
  const [checkedCompSource, setCheckedCompSource] = useState<CheckedCompSource>("EBAY_SOLD");
  const [checkedCompNote, setCheckedCompNote] = useState("");
  const [acquireListingState, setAcquireListingState] = useState<AcquireListingState>("DRAFT");
  const [keepBuying, setKeepBuying] = useState(true);
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
  const [itemCondition, setItemCondition] = useState("");
  const [itemGraderCert, setItemGraderCert] = useState("");
  const [itemStatus, setItemStatus] = useState<ItemStatus>("IN_STOCK");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [salePrice, setSalePrice] = useState("");
  const [fees, setFees] = useState("");
  const [postage, setPostage] = useState("1.75");
  const [soldAt, setSoldAt] = useState(todayInputValue());
  const [saleChannel, setSaleChannel] = useState<Channel>("EBAY");
  const [saleQuantity, setSaleQuantity] = useState("1");
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
  const [listingPackId, setListingPackId] = useState<string | null>(null);
  const [listingPackCopied, setListingPackCopied] = useState(false);
  const [listingPackCopiedField, setListingPackCopiedField] = useState<string | null>(null);
  const [cardArtUrl, setCardArtUrl] = useState<string | null>(null);
  const [gradeComp, setGradeComp] = useState<CompResult | null>(null);
  const [gradeOdds, setGradeOdds] = useState("45");
  const [gradingCost, setGradingCost] = useState("19.99");
  const [popularSets, setPopularSets] = useState<CatalogSet[]>([]);
  const [allSets, setAllSets] = useState<CatalogSet[]>([]);
  const [showAllPopularSets, setShowAllPopularSets] = useState(false);
  const [showAllQuickHunts, setShowAllQuickHunts] = useState(false);
  const [scrollToComp, setScrollToComp] = useState(false);
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
  const [recentSetIds, setRecentSetIds] = useState<string[]>([]);
  const pullStartY = useRef<number | null>(null);
  const pullTracking = useRef(false);
  const compPanelRef = useRef<HTMLElement | null>(null);

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
    try {
      setRecentSetIds(parseRecentSetIds(window.localStorage.getItem(RECENT_SETS_STORAGE_KEY)));
    } catch {
      setRecentSetIds([]);
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

  const sellingItem = useMemo(
    () => inventory.find((item) => item.id === sellingId) ?? null,
    [inventory, sellingId],
  );

  useEffect(() => {
    if (!sellingId) return;
    const estimate = estimateSaleCosts(saleChannel, poundsToPence(salePrice), { grade: sellingItem?.grade });
    if (!feesTouched) setFees(penceToPounds(estimate.feesPence));
    if (!postageTouched) setPostage(penceToPounds(estimate.postagePence));
  }, [feesTouched, postageTouched, saleChannel, salePrice, sellingId, sellingItem?.grade]);

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
  const listingPackTarget = useMemo(
    () => listings.find((listing) => listing.id === listingPackId) ?? null,
    [listingPackId, listings],
  );
  const firstDraftListingTarget = useMemo(() => {
    const nextId = nextDraftListingId(listings, null);
    return nextId ? listings.find((listing) => listing.id === nextId) ?? null : null;
  }, [listings]);
  const nextListingPackTarget = useMemo(() => {
    const nextId = nextDraftListingId(visibleListings, listingPackId);
    return nextId ? visibleListings.find((listing) => listing.id === nextId) ?? null : null;
  }, [listingPackId, visibleListings]);
  const listingPack = useMemo(() => {
    if (!listingPackTarget?.item) return null;
    const { item } = listingPackTarget;
    const savedListPrice = listingPackTarget.listPrice ?? listingPackTarget.suggestedPrice ?? undefined;
    return buildListingPack({
      card: {
        name: item.card.name,
        setName: item.card.setName,
        number: item.card.number,
        language: "EN",
      },
      grade: item.grade,
      listPricePence: savedListPrice,
      costBasisPence: item.costBasis,
      condition: item.condition,
      certNumber: item.graderCert,
    });
  }, [listingPackTarget]);
  const recentIntake = useMemo(() => inventory.slice(0, 4), [inventory]);
  const recentIntakeCostPence = useMemo(
    () => recentIntake.reduce((sum, item) => sum + item.costBasis * item.quantity, 0),
    [recentIntake],
  );
  const creatingListingItem = useMemo(
    () => inventory.find((item) => item.id === creatingListingItemId) ?? null,
    [creatingListingItemId, inventory],
  );
  const salePreview = useMemo(() => {
    if (!sellingItem) return null;
    const soldQuantity = parseIntakeQuantity(saleQuantity) ?? 0;
    const salePricePence = poundsToPence(salePrice);
    const feesPence = poundsToPence(fees);
    const postagePence = poundsToPence(postage);
    const netPence = saleNetPence({ salePricePence, feesPence, postagePence });
    const costPence = sellingItem.costBasis * soldQuantity;
    return {
      soldQuantity,
      netPence,
      costPence,
      profitPence: netPence - costPence,
    };
  }, [fees, postage, salePrice, saleQuantity, sellingItem]);
  const apiHeadline = comp?.headline ?? null;
  const catalogCard = comp?.catalog ?? null;
  const checkedComp = useMemo<CompResult | null>(
    () => {
      const built = buildCheckedComp({
        card: {
          name: catalogCard?.name ?? name,
          setName: catalogCard?.setName ?? setNameValue,
          number: catalogCard?.number ?? number,
          tcgApiId: catalogCard?.tcgApiId,
          game: "POKEMON",
          language: "EN",
        },
        grade,
        pricePence: checkedCompPrice.trim() ? poundsToPence(checkedCompPrice) : 0,
        sampleSize: Number(checkedCompSample),
        windowDays: 30,
        source: checkedCompSource,
        note: checkedCompNote,
      });
      return built as CompResult | null;
    },
    [
      catalogCard?.name,
      catalogCard?.number,
      catalogCard?.setName,
      catalogCard?.tcgApiId,
      checkedCompNote,
      checkedCompPrice,
      checkedCompSample,
      checkedCompSource,
      grade,
      name,
      number,
      setNameValue,
    ],
  );
  const headline = checkedComp ?? apiHeadline;
  const compForReceipt = useMemo<Reconciled | null>(() => {
    if (!comp) return null;
    if (!checkedComp) return comp;
    return {
      ...comp,
      headline: checkedComp,
      all: [checkedComp, ...comp.all],
      sourcesDisagree: false,
    };
  }, [checkedComp, comp]);
  const deal = useMemo(
    () => (headline ? judgeDeal(headline, poundsToPence(cost), channel, grade, condition) : null),
    [channel, condition, headline, cost, grade],
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
  const selectedSet = useMemo(() => findSelectedSet([...popularSets, ...setSuggestions, ...allSets], setNameValue), [
    allSets,
    popularSets,
    setNameValue,
    setSuggestions,
  ]);
  const visiblePopularSets = showAllPopularSets ? popularSets : popularSets.slice(0, VISIBLE_POPULAR_SET_LIMIT);
  const visibleQuickHunts = showAllQuickHunts ? quickHunts : quickHunts.slice(0, VISIBLE_QUICK_HUNT_LIMIT);
  const recentSets = useMemo(() => {
    const byId = new Map([...allSets, ...popularSets, ...setSuggestions].map((set) => [set.id, set]));
    return recentSetIds
      .map((id) => byId.get(id))
      .filter((set): set is CatalogSet => Boolean(set));
  }, [allSets, popularSets, recentSetIds, setSuggestions]);
  const setMarkUrl =
    catalogCard?.setLogoUrl ?? catalogCard?.setSymbolUrl ?? selectedSet?.logoUrl ?? selectedSet?.symbolUrl ?? null;
  const displayCardName = catalogCard?.name ?? name;
  const displaySetName = catalogCard?.setName ?? setNameValue;
  const displayNumber = catalogCard?.number ?? number;
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
  const compReceipt = useMemo(() => (compForReceipt ? buildCompReceipt(compForReceipt) : []), [compForReceipt]);
  const needsManualComp = Boolean(
    apiHeadline &&
      !checkedComp &&
      (apiHeadline.medianPence <= 0 || apiHeadline.sampleSize <= 0),
  );
  const manualCompCard = useMemo(
    () => ({
      name: catalogCard?.name ?? name,
      setName: catalogCard?.setName ?? setNameValue,
      number: catalogCard?.number ?? number,
    }),
    [catalogCard?.name, catalogCard?.number, catalogCard?.setName, name, number, setNameValue],
  );
  const manualCompFallbackQuery = useMemo(
    () => cardSearchQuery(manualCompCard, { condition }),
    [condition, manualCompCard],
  );
  const quickIntakeManualQuery = useMemo(() => normalizeManualCompSearchText(quickIntake), [quickIntake]);
  const manualCompSearchText = manualCompQuery || quickIntakeManualQuery;
  const manualCompLinks = useMemo(
    () => buildManualCompLinks(manualCompCard, grade, { searchText: manualCompSearchText, condition }),
    [condition, grade, manualCompCard, manualCompSearchText],
  );
  const compSpreadPct = useMemo(() => (compForReceipt ? medianSpreadPct(compForReceipt.all) : null), [compForReceipt]);
  const dealerVerdict = useMemo(
    () => (checkedComp ? null : compForReceipt ? buildDealerCompVerdict(compForReceipt) : null),
    [checkedComp, compForReceipt],
  );
  const confidenceLabel = dealerVerdict
    ? { label: dealerVerdict.label, tone: dealerVerdict.tone }
    : headline
      ? compConfidence(headline, compForReceipt?.sourcesDisagree ?? false)
      : null;
  const stockImportPreview = useMemo(() => parseStockImportText(stockImportText), [stockImportText]);
  const stockImportHasText = stockImportText.trim().length > 0;
  const projectedListSuggestion = useMemo(
    () =>
      headline
        ? suggestListPrice({
            comp: headline,
            strategy,
            costBasisPence: poundsToPence(cost),
            condition,
          })
        : null,
    [condition, headline, strategy, cost],
  );
  const conditionAdjustmentActive = grade === "RAW" && rawConditionPriceFactor(grade, condition) < 1;
  const buyPlan = useMemo(() => {
    const intakeQuantity = parseIntakeQuantity(quantity) ?? 1;
    const overrideListPricePence = listPriceOverride.trim() ? poundsToPence(listPriceOverride) : null;
    const listPricePence = overrideListPricePence ?? projectedListSuggestion?.pricePence ?? headline?.medianPence ?? 0;
    if (listPricePence <= 0) return null;

    return buildBuyPlan({
      unitCostPence: poundsToPence(cost),
      quantity: intakeQuantity,
      listPricePence,
      channel,
      grade,
      cautious: checkedComp
        ? checkedComp.sampleSize < 2
        : Boolean(compForReceipt?.sourcesDisagree || (dealerVerdict && dealerVerdict.tone !== "good")),
    });
  }, [
    channel,
    compForReceipt?.sourcesDisagree,
    cost,
    checkedComp,
    dealerVerdict,
    grade,
    headline?.medianPence,
    listPriceOverride,
    projectedListSuggestion?.pricePence,
    quantity,
  ]);
  const quickStockQuantity = parseIntakeQuantity(quantity) ?? 0;
  const quickStockCostPence = poundsToPence(cost);
  const quickStockListPence = listPriceOverride.trim()
    ? poundsToPence(listPriceOverride)
    : projectedListSuggestion?.pricePence ?? headline?.medianPence ?? 0;
  const quickStockReady = Boolean(headline && quickStockQuantity > 0 && quickStockCostPence > 0 && quickStockListPence > 0);
  const buyTargetSuggestion = useMemo(
    () =>
      headline
        ? buildBuyTargetSuggestion({
            targetBuyPence: deal?.targetBuyPence ?? null,
            compMedianPence: headline.medianPence,
            currentTargetPence: poundsToPence(watchTarget),
          })
        : null,
    [deal?.targetBuyPence, headline, watchTarget],
  );
  const buyFlowSteps = useMemo<BuyFlowStep[]>(() => {
    const cardReady = Boolean(name.trim() && setNameValue.trim());
    const compReady = Boolean(headline);
    const costPence = poundsToPence(cost);
    const qty = parseIntakeQuantity(quantity) ?? 0;
    const stockReady = costPence > 0 && qty > 0;
    const decisionTone = confidenceLabel?.tone ?? "wait";

    return [
      {
        label: "Card",
        detail: cardReady
          ? [displaySetName, displayNumber ? `#${displayNumber}` : null].filter(Boolean).join(" ")
          : "card + set",
        state: cardReady ? "done" : "current",
      },
      {
        label: "Comp",
        detail: headline ? `${gbp(headline.medianPence)} · ${confidenceLabel?.label ?? "priced"}` : "lookup",
        state: compReady ? "done" : cardReady ? "current" : "wait",
      },
      {
        label: "Decision",
        detail: deal?.label ?? confidenceLabel?.label ?? "target",
        state: !compReady ? "wait" : decisionTone === "good" ? "done" : "warn",
      },
      {
        label: "Stock",
        detail: stockReady ? `${qty} @ ${gbp(costPence)}` : "cost + qty",
        state: compReady ? "current" : "wait",
      },
    ];
  }, [
    confidenceLabel?.label,
    confidenceLabel?.tone,
    cost,
    deal?.label,
    displayNumber,
    displaySetName,
    headline,
    name,
    quantity,
    setNameValue,
  ]);

  useEffect(() => {
    if (!scrollToComp || !headline || !compPanelRef.current) return;
    const handle = window.setTimeout(() => {
      compPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollToComp(false);
    }, 80);
    return () => window.clearTimeout(handle);
  }, [headline, scrollToComp]);

  const dashboardLoading = dashboard === null;
  const noBookedSales = !dashboardLoading && (dashboard?.metrics.soldCount ?? 0) === 0;
  const netProfitPence = dashboard?.metrics.netProfitPence ?? dashboard?.metrics.realizedProfitPence ?? 0;
  const netProfitTone = netProfitPence >= 0 ? "good" : "warn";
  const cashNetPence = dashboard?.metrics.cashNetPence ?? 0;
  const cashNetTone = cashNetPence >= 0 ? "good" : "warn";
  const profitTrend = useMemo(() => buildProfitTrend(dashboard?.recentSales ?? []), [dashboard?.recentSales]);
  const chaseLine = dashboard
    ? `${dashboard.metrics.stockCount} stocked / ${dashboard.metrics.soldCount} sold`
    : "loading deck";
  const draftListingCount = Number(dashboard?.listingsByState.DRAFT ?? 0);
  const activeListingCount = Number(dashboard?.listingsByState.ACTIVE ?? 0);
  const activeWatchCount = watches.filter((watch) => watch.active).length;
  const unlistedStock = useMemo(
    () =>
      activeInventory.filter(
        (item) =>
          item.status === "IN_STOCK" &&
          !item.listings.some((listing) => listing.state === "DRAFT" || listing.state === "ACTIVE"),
      ),
    [activeInventory],
  );
  const visibleUnlistedStock = useMemo(
    () => buildInventoryView(unlistedStock, { query: listingQuery, sort: "newest" }),
    [listingQuery, unlistedStock],
  );
  const unlistedStockCount = unlistedStock.length;
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
  const launchReadiness = useMemo(
    () =>
      systemStatus
        ? buildLaunchReadiness({
            livePrimaryComps: systemStatus.summary.livePrimaryComps,
            liveCatalogKey: systemStatus.summary.liveCatalogKey,
            secondaryCrossCheck: systemStatus.summary.secondaryCrossCheck,
            alertDelivery: systemStatus.summary.alertDelivery,
            stockCount: dashboard?.metrics.stockCount ?? activeInventory.length,
            draftListings: draftListingCount,
            activeListings: activeListingCount,
            soldCount: dashboard?.metrics.soldCount ?? soldInventory.length,
            activeWatches: activeWatchCount,
            operatingExpensePence: dashboard?.metrics.operatingExpensePence ?? 0,
          })
        : [],
    [
      activeInventory.length,
      activeListingCount,
      activeWatchCount,
      dashboard?.metrics.operatingExpensePence,
      dashboard?.metrics.soldCount,
      dashboard?.metrics.stockCount,
      draftListingCount,
      soldInventory.length,
      systemStatus?.summary.alertDelivery,
      systemStatus?.summary.liveCatalogKey,
      systemStatus?.summary.livePrimaryComps,
      systemStatus?.summary.secondaryCrossCheck,
    ],
  );
  const launchPlan = useMemo(
    () =>
      buildLaunchPlan({
        stockCount: dashboard?.metrics.stockCount ?? activeInventory.length,
        draftListings: draftListingCount,
        activeListings: activeListingCount,
        soldCount: dashboard?.metrics.soldCount ?? soldInventory.length,
        activeWatches: activeWatchCount,
        operatingExpensePence: dashboard?.metrics.operatingExpensePence ?? 0,
        setupKnown: Boolean(systemStatus),
        secondaryCrossCheck: Boolean(systemStatus?.summary.secondaryCrossCheck),
        alertDelivery: Boolean(systemStatus?.summary.alertDelivery),
      }),
    [
      activeInventory.length,
      activeListingCount,
      activeWatchCount,
      dashboard?.metrics.operatingExpensePence,
      dashboard?.metrics.soldCount,
      dashboard?.metrics.stockCount,
      draftListingCount,
      soldInventory.length,
      systemStatus?.summary.alertDelivery,
      systemStatus?.summary.secondaryCrossCheck,
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
    if (target === "sales") {
      setListingStateFilter("ACTIVE");
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

  function openLaunchReadiness(target: LaunchReadinessTarget | undefined) {
    if (!target || target === "external") return;
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
    if (target === "listings") {
      setListingStateFilter("ALL");
      setListingSort("newest");
      setView("listings");
      return;
    }
    setView("pnl");
  }

  function openLaunchPlan(target: LaunchPlanTarget) {
    if (target === "external") return;
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
    if (target === "listings") {
      setListingStateFilter("ALL");
      setListingSort("newest");
      setView("listings");
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

  function clearCheckedComp() {
    setCheckedCompPrice("");
    setCheckedCompSample("1");
    setCheckedCompSource("EBAY_SOLD");
    setCheckedCompNote("");
  }

  function applyPostStockFlow() {
    if (!keepBuying) {
      setView("inventory");
      return;
    }

    const next = nextIntakeFormAfterStock(
      { name, setName: setNameValue, number, cost, quantity },
      true,
    );
    setName(next.name);
    setSetNameValue(next.setName);
    setNumber(next.number);
    setCost(next.cost);
    setQuantity(next.quantity);
    setComp(null);
    setSuggestion(null);
    setCardArtUrl(null);
    setGradeComp(null);
    setListPriceOverride("");
    setManualCompQuery("");
    setQuickIntake("");
    clearCheckedComp();
    setGraderCert("");
  }

  function applyQuickIntake(options: { lookupAfter?: boolean } = {}) {
    const parsed = parseQuickIntake(quickIntake);
    const filled: string[] = [];
    const manualQuery = normalizeManualCompSearchText(quickIntake);
    const identityChanged = Boolean(parsed.name || parsed.setName);
    const nextLookup: LookupInput = {
      name: parsed.name ?? name,
      setName: parsed.setName ?? setNameValue,
      number: parsed.number ?? (identityChanged ? "" : number),
      grade: parsed.grade ?? grade,
    };

    if (parsed.name) {
      setName(parsed.name);
      filled.push("card");
    }
    if (parsed.setName) {
      setSetNameValue(parsed.setName);
      pinRecentSetName(parsed.setName);
      filled.push("set");
    }
    if (parsed.number) {
      setNumber(parsed.number);
      filled.push("number");
    } else if (identityChanged) {
      setNumber("");
    }
    if (parsed.grade) {
      setGrade(parsed.grade);
      filled.push("grade");
    }
    if (parsed.cost) {
      setCost(parsed.cost);
      filled.push("cost");
    }
    if (parsed.quantity) {
      setQuantity(parsed.quantity);
      filled.push("qty");
    }
    if (parsed.source) {
      setSource(parsed.source);
      filled.push("source");
    }
    if (parsed.location) {
      setLocation(parsed.location);
      filled.push("location");
    }
    if (parsed.condition) {
      setCondition(parsed.condition);
      filled.push("condition");
    }
    if (manualQuery) {
      setManualCompQuery(manualQuery);
    }

    if (filled.length === 0) {
      setError("Quick fill needs a card, set, number, grade, cost or quantity.");
      return;
    }

    setComp(null);
    setSuggestion(null);
    setCardArtUrl(null);
    setGradeComp(null);
    clearCheckedComp();
    setError(null);
    if (options.lookupAfter) {
      if (!nextLookup.name.trim()) {
        setError("Quick comp needs a card name.");
        return;
      }
      setNotice(`Filled ${filled.join(", ")}. Looking up comp...`);
      void lookupComp(nextLookup);
      return;
    }
    setNotice(`Filled ${filled.join(", ")}.`);
  }

  async function lookup(event?: FormEvent) {
    event?.preventDefault();
    await lookupComp({ name, setName: setNameValue, number, grade });
  }

  async function lookupComp(input: LookupInput) {
    setBusy("lookup");
    setError(null);
    setNotice(null);
    setSuggestion(null);
    clearCheckedComp();
    try {
      const qs = new URLSearchParams({
        name: input.name,
        set: input.setName,
        number: input.number,
        grade: input.grade,
      });
      const res = await fetch(`/api/comps?${qs}`);
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "lookup failed");
      setComp(payload);
      setCardArtUrl(payload.catalog?.imageUrl ?? null);
      pinRecentSetName(payload.catalog?.setName ?? input.setName);
      setGradeComp(null);
      setScrollToComp(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "lookup failed");
    } finally {
      setBusy(null);
    }
  }

  async function verifyPsaCert() {
    const cert = graderCert.trim();
    if (!cert) {
      setError("Enter a PSA cert number first.");
      return;
    }
    setBusy("psa");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/psa/cert?cert=${encodeURIComponent(cert)}`);
      const payload = await readJson(res);
      const result = payload.result as PsaCertView | undefined;
      if (!res.ok || !result) {
        throw new Error(payload.error ?? "PSA lookup failed");
      }
      setPsaResult(result);
      if (!result.found) {
        setNotice(result.reason ?? "No PSA cert data found.");
        return;
      }
      // Auto-fill the buy form from the verified slab so a comp can follow.
      if (result.subject) setName(toTitleCase(result.subject));
      if (result.cardNumber) setNumber(result.cardNumber);
      if (result.grade) setGrade(result.grade);
      clearCheckedComp();
      setNotice(
        `Verified PSA ${result.gradeLabel ?? ""} ${toTitleCase(result.subject ?? "card")}${
          result.live ? "" : " (demo cert — add PSA_API_TOKEN for live)"
        }. Card filled — run a comp.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "PSA lookup failed");
    } finally {
      setBusy(null);
    }
  }

  async function acquire(event?: FormEvent) {
    event?.preventDefault();
    const intakeQuantity = parseIntakeQuantity(quantity);
    if (!intakeQuantity) {
      setError("Quantity must be a whole number above 0.");
      return;
    }
    if (poundsToPence(cost) <= 0) {
      setError("Cost must be above £0.");
      return;
    }
    const overrideListPricePence = listPriceOverride.trim() ? poundsToPence(listPriceOverride) : null;
    if (overrideListPricePence != null && overrideListPricePence <= 0) {
      setError("List price must be above £0 or left blank.");
      return;
    }

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
          quantity: intakeQuantity,
          acquiredFrom: source || undefined,
          location: location || undefined,
          condition: condition.trim() || undefined,
          graderCert: graderCert.trim() || undefined,
          strategy,
          channel,
          listPricePence: overrideListPricePence ?? undefined,
          listingState: acquireListingState,
          createListing: true,
          checkedComp: checkedComp
            ? {
                pricePence: checkedComp.medianPence,
                sampleSize: checkedComp.sampleSize,
                windowDays: checkedComp.windowDays,
                source: checkedCompSource,
                note: checkedCompNote.trim() || undefined,
              }
            : undefined,
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "acquire failed");
      setSuggestion(payload.suggestion);
      setComp(payload.comps ?? { headline: payload.comp, all: [payload.comp], sourcesDisagree: false });
      if (payload.catalog?.imageUrl) setCardArtUrl(payload.catalog.imageUrl);
      pinRecentSetName(payload.catalog?.setName ?? setNameValue);
      const listedPence = payload.listing?.listPrice ?? payload.listing?.suggestedPrice ?? payload.suggestion.pricePence;
      const listingVerb = payload.listing?.state === "ACTIVE" ? "Listed" : "Drafted";
      setNotice(
        `${intakeQuantity > 1 ? `${intakeQuantity} copies stocked` : "Stocked"}. ${listingVerb} at ${gbp(listedPence)}.`,
      );
      await refreshAll();
      applyPostStockFlow();
    } catch (err) {
      setError(err instanceof Error ? err.message : "acquire failed");
    } finally {
      setBusy(null);
    }
  }

  async function stockWithoutComp() {
    const intakeQuantity = parseIntakeQuantity(quantity);
    if (!intakeQuantity) {
      setError("Quantity must be a whole number above 0.");
      return;
    }
    const overrideListPricePence = listPriceOverride.trim() ? poundsToPence(listPriceOverride) : null;
    if (overrideListPricePence != null && overrideListPricePence <= 0) {
      setError("List price must be above £0 or left blank.");
      return;
    }
    if (poundsToPence(cost) <= 0) {
      setError("Cost must be above £0.");
      return;
    }

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
          quantity: intakeQuantity,
          costBasisPence,
          acquiredFrom: source || undefined,
          location: location || undefined,
          condition: condition.trim() || undefined,
          graderCert: graderCert.trim() || undefined,
          status: "IN_STOCK",
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "manual stock failed");

      let listingCreated = false;
      if (payload.item?.id) {
        const listPricePence = overrideListPricePence ?? draftDefaults.listPricePence;
        const listingRes = await fetch("/api/listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: payload.item.id,
            channel,
            state: acquireListingState,
            listPricePence,
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
          ? `${intakeQuantity > 1 ? `${intakeQuantity} copies stocked` : "Stocked"} manually. ${acquireListingState === "ACTIVE" ? "Listed" : "Drafted"} at ${gbp(overrideListPricePence ?? draftDefaults.listPricePence)}.`
          : `${intakeQuantity > 1 ? `${intakeQuantity} copies stocked` : "Stocked"} manually. Add a listing from Stock when ready.`,
      );
      await refreshAll();
      applyPostStockFlow();
    } catch (err) {
      setError(err instanceof Error ? err.message : "manual stock failed");
    } finally {
      setBusy(null);
    }
  }

  async function importStockRows(event: FormEvent) {
    event.preventDefault();
    const parsed = parseStockImportText(stockImportText);
    if (parsed.errors.length > 0) {
      setError(`${parsed.errors.length} import row${parsed.errors.length === 1 ? "" : "s"} need fixing.`);
      return;
    }
    if (parsed.rows.length === 0) {
      setError("Paste at least one stock row to import.");
      return;
    }

    setBusy("stock-import");
    setError(null);
    setNotice(null);
    let stocked = 0;
    let listingsCreated = 0;

    try {
      for (const row of parsed.rows) {
        const stockRes = await fetch("/api/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            card: row.card,
            grade: row.grade,
            quantity: row.quantity,
            costBasisPence: row.costBasisPence,
            acquiredFrom: row.acquiredFrom ?? "Opening stock",
            location: (row.location ?? location) || undefined,
            condition: row.condition,
            graderCert: row.graderCert,
            status: "IN_STOCK",
          }),
        });
        const stockPayload = await readJson(stockRes);
        if (!stockRes.ok) throw new Error(stockPayload.error ?? "stock import failed");
        stocked += 1;

        if (row.listPricePence != null && stockPayload.item?.id) {
          const listingRes = await fetch("/api/listings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              itemId: stockPayload.item.id,
              channel: row.channel ?? channel,
              state: row.listingState ?? "DRAFT",
              listPricePence: row.listPricePence,
            }),
          });
          const listingPayload = await readJson(listingRes);
          if (!listingRes.ok) {
            console.warn("[stock import] listing skipped:", listingPayload.error ?? "listing create failed");
          } else {
            listingsCreated += 1;
          }
        }
      }

      setStockImportText("");
      setNotice(
        `Imported ${stocked} stock row${stocked === 1 ? "" : "s"}${listingsCreated > 0 ? ` and ${listingsCreated} listing${listingsCreated === 1 ? "" : "s"}` : ""}.`,
      );
      await refreshAll();
      setView("inventory");
    } catch (err) {
      setError(err instanceof Error ? err.message : "stock import failed");
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
    setShowAllQuickHunts(false);
    setNotice("Quick hunts reset.");
    setError(null);
  }

  function chooseQuickHunt(card: QuickHuntCard, options: { lookupAfter?: boolean } = {}) {
    const nextLookup = {
      name: card.name,
      setName: card.setName,
      number: card.number,
      grade,
    };
    setName(card.name);
    setSetNameValue(card.setName);
    setNumber(card.number);
    setComp(null);
    setSuggestion(null);
    setCardArtUrl(card.imageUrl ?? null);
    setGradeComp(null);
    setManualCompQuery("");
    clearCheckedComp();
    setNotice(null);
    setError(null);
    if (options.lookupAfter) {
      setNotice(`Looking up ${card.name}...`);
      void lookupComp(nextLookup);
    }
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
    pinRecentSet(set.id);
    setManualCompQuery("");
    clearCheckedComp();
  }

  function chooseCard(card: CatalogCard) {
    setName(card.name);
    setSetNameValue(card.setName);
    pinRecentSetName(card.setName);
    if (card.number) setNumber(card.number);
    if (card.imageUrl) setCardArtUrl(card.imageUrl);
    setCardSuggestionsOpen(false);
    setManualCompQuery("");
    clearCheckedComp();
    setError(null);
  }

  function loadRecentBuy(item: InventoryItem, options: { lookupAfter?: boolean } = {}) {
    const nextGrade = item.grade as Grade;
    const nextCondition = item.condition ?? (nextGrade === "RAW" ? "NM" : "");
    const nextLookup = {
      name: item.card.name,
      setName: item.card.setName,
      number: item.card.number ?? "",
      grade: nextGrade,
    };

    setView("acquire");
    setName(item.card.name);
    setSetNameValue(item.card.setName);
    setNumber(item.card.number ?? "");
    setGrade(nextGrade);
    setCost("");
    setQuantity("1");
    setSource(item.acquiredFrom ?? source);
    setLocation(item.location ?? location);
    setCondition(nextCondition);
    setGraderCert("");
    setPsaResult(null);
    setQuickIntake("");
    setComp(null);
    setSuggestion(null);
    setCardArtUrl(item.card.imageUrl);
    setGradeComp(null);
    setListPriceOverride("");
    setManualCompQuery(
      cardSearchQuery(
        {
          name: item.card.name,
          setName: item.card.setName,
          number: item.card.number ?? undefined,
        },
        { condition: nextCondition },
      ),
    );
    clearCheckedComp();
    setError(null);

    if (options.lookupAfter) {
      setNotice(`Looking up ${item.card.name}...`);
      void lookupComp(nextLookup);
      return;
    }

    setNotice(`${item.card.name} loaded for another buy.`);
  }

  function pinRecentSetName(value: string | null | undefined) {
    if (!value?.trim()) return;
    const match = findSelectedSet([...popularSets, ...setSuggestions, ...allSets], value);
    if (match) pinRecentSet(match.id);
  }

  function pinRecentSet(id: string) {
    setRecentSetIds((current) => {
      const next = pinRecentSetId(current, id);
      try {
        window.localStorage.setItem(RECENT_SETS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Device storage is optional; the current session still benefits.
      }
      return next;
    });
  }

  function openSell(item: InventoryItem, listing?: Listing) {
    const saleListing = listing ?? item.listings[0];
    const price = saleListing?.listPrice ?? saleListing?.suggestedPrice ?? item.costBasis;
    const nextChannel = saleListing?.channel ?? "EBAY";
    const grossSalePrice = defaultGrossSalePence(nextChannel, price, { grade: item.grade });
    const estimate = estimateSaleCosts(nextChannel, grossSalePrice, { grade: item.grade });
    setSellingId(item.id);
    setEditingItemId(null);
    setEditingListingId(null);
    setCreatingListingItemId(null);
    setSalePrice(penceToPounds(grossSalePrice));
    setSaleQuantity("1");
    setFees(penceToPounds(estimate.feesPence));
    setPostage(penceToPounds(estimate.postagePence));
    setSoldAt(todayInputValue());
    setSaleChannel(nextChannel);
    setFeesTouched(false);
    setPostageTouched(false);
    setError(null);
    setNotice(null);
  }

  function openSellFromListing(listing: Listing): boolean {
    if (!listing.item) {
      setError("This listing is missing its stock row.");
      return false;
    }
    if (listing.item.status === "SOLD") {
      setError("That stock row is already sold.");
      return false;
    }
    openSell(listing.item, listing);
    return true;
  }

  function openSellFromListingPack(listing: Listing) {
    if (!openSellFromListing(listing)) return;
    setListingPackId(null);
    setListingPackCopied(false);
    setListingPackCopiedField(null);
  }

  function applySaleChannelPreset(nextChannel: Channel) {
    const currentGross = poundsToPence(salePrice);
    const currentItemSubtotal =
      currentGross > 0 ? Math.max(0, currentGross - buyerPaidPostagePence(saleChannel, sellingItem?.grade)) : 0;
    const nextGross =
      currentItemSubtotal > 0
        ? defaultGrossSalePence(nextChannel, currentItemSubtotal, { grade: sellingItem?.grade })
        : currentGross;
    const estimate = estimateSaleCosts(nextChannel, nextGross, { grade: sellingItem?.grade });
    setSaleChannel(nextChannel);
    setSalePrice(penceToPounds(nextGross));
    setFees(penceToPounds(estimate.feesPence));
    setPostage(penceToPounds(estimate.postagePence));
    setFeesTouched(false);
    setPostageTouched(false);
  }

  function saleQuantityForShortcuts(): number {
    const parsed = parseIntakeQuantity(saleQuantity) ?? 1;
    return Math.max(1, Math.min(sellingItem?.quantity ?? 1, parsed));
  }

  function saleUnitReferencePence(): number {
    if (!sellingItem) return 0;
    const quantityForPrice = saleQuantityForShortcuts();
    const currentTotal = poundsToPence(salePrice);
    if (currentTotal > 0) {
      const itemSubtotal = Math.max(0, currentTotal - buyerPaidPostagePence(saleChannel, sellingItem.grade));
      return Math.round(itemSubtotal / quantityForPrice);
    }
    return saleListPrice(sellingItem) ?? sellingItem.costBasis;
  }

  function applySaleTotalPrice(totalPence: number) {
    const safeTotal = Math.max(0, Math.round(totalPence));
    const estimate = estimateSaleCosts(saleChannel, safeTotal, { grade: sellingItem?.grade });
    setSalePrice(penceToPounds(safeTotal));
    setFees(penceToPounds(estimate.feesPence));
    setPostage(penceToPounds(estimate.postagePence));
    setFeesTouched(false);
    setPostageTouched(false);
  }

  function applySaleItemSubtotal(itemSubtotalPence: number) {
    applySaleTotalPrice(defaultGrossSalePence(saleChannel, itemSubtotalPence, { grade: sellingItem?.grade }));
  }

  function useListingSalePrice() {
    if (!sellingItem) return;
    const unitPrice = saleListPrice(sellingItem) ?? sellingItem.costBasis;
    applySaleItemSubtotal(unitPrice * saleQuantityForShortcuts());
  }

  function applySalePriceMultiplier(multiplier: number) {
    if (!sellingItem) return;
    applySaleItemSubtotal(Math.round(saleUnitReferencePence() * multiplier) * saleQuantityForShortcuts());
  }

  function useBreakEvenSalePrice() {
    if (!sellingItem) return;
    applySaleTotalPrice(
      breakEvenSalePricePence(saleChannel, sellingItem.costBasis * saleQuantityForShortcuts(), {
        grade: sellingItem.grade,
      }),
    );
  }

  function sellAllQuantity() {
    if (!sellingItem) return;
    const unitPrice = saleUnitReferencePence();
    setSaleQuantity(String(sellingItem.quantity));
    applySaleItemSubtotal(unitPrice * sellingItem.quantity);
  }

  function applyCashSale() {
    setSaleChannel("IN_PERSON");
    setFees("0.00");
    setPostage("0.00");
    setFeesTouched(true);
    setPostageTouched(true);
  }

  function resetSaleCosts() {
    const estimate = estimateSaleCosts(saleChannel, poundsToPence(salePrice), { grade: sellingItem?.grade });
    setFees(penceToPounds(estimate.feesPence));
    setPostage(penceToPounds(estimate.postagePence));
    setFeesTouched(false);
    setPostageTouched(false);
  }

  function clearSalePostage() {
    setPostage("0.00");
    setPostageTouched(true);
  }

  function openInventoryEditor(item: InventoryItem) {
    setEditingItemId(item.id);
    setSellingId(null);
    setCreatingListingItemId(null);
    setItemQuantity(String(item.quantity));
    setItemCost(penceToPounds(item.costBasis));
    setItemSource(item.acquiredFrom ?? "");
    setItemLocation(item.location ?? "");
    setItemCondition(item.condition ?? "");
    setItemGraderCert(item.graderCert ?? "");
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
          condition: itemCondition.trim() || null,
          graderCert: itemGraderCert.trim() || null,
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
    const item = sellingItem;
    const soldQuantity = parseIntakeQuantity(saleQuantity);
    if (!item || !soldQuantity) {
      setError("Sold quantity must be a whole number above 0.");
      return;
    }
    if (soldQuantity > item.quantity) {
      setError(`Only ${item.quantity} in stock.`);
      return;
    }
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
          quantity: soldQuantity,
          soldAt: soldAtIso(soldAt),
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "mark sold failed");
      setNotice(`${soldQuantity > 1 ? `${soldQuantity} copies sold` : "Sold"}. Profit ${gbp(payload.profitPence)}.`);
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

  function requestUndoSale(sale: SaleSummary) {
    setDeleteTarget({ kind: "sale", sale });
  }

  async function undoSale(sale: SaleSummary) {
    setBusy(`sale-${sale.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sales/${sale.id}`, { method: "DELETE" });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "sale undo failed");
      setNotice("Sale undone. One copy restored to Stock.");
      setDeleteTarget(null);
      await refreshAll();
      setView("inventory");
    } catch (err) {
      setError(err instanceof Error ? err.message : "sale undo failed");
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
    setListingPackId(null);
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

  function listingForInventoryItem(item: InventoryItem): Listing | null {
    const listing =
      item.listings.find((row) => row.state === "DRAFT") ??
      item.listings.find((row) => row.state === "ACTIVE") ??
      item.listings.find((row) => row.state !== "SOLD" && row.state !== "ENDED") ??
      item.listings[0];
    if (!listing) return null;
    return listings.find((row) => row.id === listing.id) ?? { ...listing, item };
  }

  function openRecentListingWork(item: InventoryItem) {
    const listing = listingForInventoryItem(item);
    setView("listings");
    if (!listing) {
      openListingCreator(item);
      setListingStateFilter("DRAFT");
      return;
    }
    setListingStateFilter(listing.state === "ACTIVE" || listing.state === "DRAFT" ? listing.state : "ALL");
    openListingPack(listing);
  }

  function sellRecentBuy(item: InventoryItem) {
    setView("inventory");
    openSell(item, listingForInventoryItem(item) ?? undefined);
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
    if (target.kind === "sale") {
      await undoSale(target.sale);
      return;
    }
    await deleteWatch(target.watch);
  }

  function openListingEditor(listing: Listing) {
    setEditingListingId(listing.id);
    setCreatingListingItemId(null);
    setListingPackId(null);
    setListingPrice(penceToPounds(listing.listPrice ?? listing.suggestedPrice ?? 0));
    setListingState(listing.state === "SOLD" ? "ENDED" : listing.state);
    setListingChannel(listing.channel);
    setListingExternalUrl(listing.externalUrl ?? "");
  }

  function openListingPack(listing: Listing) {
    if (!listing.item) {
      setError("This listing is missing its stock row.");
      return;
    }
    setListingPackId(listing.id);
    setListingPackCopied(false);
    setListingPackCopiedField(null);
    setEditingListingId(null);
    setCreatingListingItemId(null);
    setSellingId(null);
    setError(null);
    setNotice(null);
  }

  async function copyListingPack() {
    if (!listingPack) return;
    try {
      await navigator.clipboard.writeText(listingPack.copyReady);
      setListingPackCopied(true);
      setListingPackCopiedField(null);
      setNotice("Listing pack copied.");
    } catch {
      setError("Copy failed. Select the listing block and copy it manually.");
    }
  }

  async function copyListingPackField(field: ListingPackCopyField) {
    try {
      await navigator.clipboard.writeText(field.value);
      setListingPackCopied(false);
      setListingPackCopiedField(field.key);
      setNotice(`${field.label} copied.`);
    } catch {
      setError("Copy failed. Select the field and copy it manually.");
    }
  }

  function openNextListingPack() {
    if (!nextListingPackTarget) return;
    setListingPackId(nextListingPackTarget.id);
    setListingPackCopied(false);
    setListingPackCopiedField(null);
    setError(null);
    setNotice(null);
  }

  function startListingDesk() {
    if (firstDraftListingTarget) {
      setView("listings");
      setListingStateFilter("DRAFT");
      openListingPack(firstDraftListingTarget);
      return;
    }

    const item = unlistedStock[0];
    if (!item) {
      setError("No draft listings or unlisted stock ready.");
      return;
    }
    setView("listings");
    setListingStateFilter("DRAFT");
    openListingCreator(item);
  }

  async function activateListingPackTarget() {
    if (!listingPackTarget) return;
    const nextId = nextListingPackTarget?.id ?? null;
    const ok = await patchListing(
      listingPackTarget,
      { state: "ACTIVE" },
      nextId ? "Listing activated. Next draft ready." : "Listing activated.",
    );
    if (!ok) return;
    setListingPackId(nextId);
    setListingPackCopied(false);
    setListingPackCopiedField(null);
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "listing update failed");
      return false;
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

  async function copyManualCompQuery() {
    const query = manualCompLinks.find((link) => link.kind === "EBAY_UK_SOLD")?.query ?? manualCompFallbackQuery;
    if (!query.trim()) return;
    try {
      await navigator.clipboard.writeText(query);
      setNotice("Manual comp query copied.");
      setError(null);
    } catch {
      setError("Copy failed. Select the manual search text and copy it.");
    }
  }

  function renderManualCompLinks(variant: "compact" | "full" | "priority" = "full") {
    const ebayQuery = manualCompLinks.find((link) => link.kind === "EBAY_UK_SOLD")?.query ?? manualCompFallbackQuery;
    return (
      <div className={`manual-comp-links ${variant}`} aria-label="Manual comp checks">
        <div className="manual-comp-heading">
          <span>Manual checks</span>
          <strong>UK sold first</strong>
        </div>
        <label className="manual-comp-search">
          <span>Search</span>
          <input
            value={manualCompQuery}
            onChange={(event) => setManualCompQuery(event.target.value)}
            placeholder={quickIntakeManualQuery || manualCompFallbackQuery || "Hitmontop Neo Genesis 1st Edition LP"}
          />
        </label>
        <div className="manual-comp-actions">
          {quickIntakeManualQuery && quickIntakeManualQuery !== manualCompQuery && (
            <button type="button" onClick={() => setManualCompQuery(quickIntakeManualQuery)}>
              Use typed
            </button>
          )}
          <button type="button" onClick={() => setManualCompQuery(manualCompFallbackQuery)} disabled={!manualCompFallbackQuery.trim()}>
            Use fields
          </button>
          <button type="button" onClick={() => void copyManualCompQuery()} disabled={!ebayQuery.trim()}>
            Copy
          </button>
        </div>
        {ebayQuery && <div className="manual-comp-query">{ebayQuery}</div>}
        {manualCompLinks.map((link) => (
          <a key={link.kind} className={link.primary ? "primary-link" : ""} href={link.url} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        ))}
      </div>
    );
  }

  function renderCheckedCompCard(variant: "full" | "priority" = "full") {
    return (
      <div className={`checked-comp-card ${checkedComp ? "active" : ""} ${variant}`}>
        <div className="checked-comp-heading">
          <div>
            <span>Checked comp</span>
            <strong>{checkedComp ? `${gbp(checkedComp.medianPence)} in use` : "Optional override"}</strong>
          </div>
          {checkedComp && (
            <button className="ghost-button" type="button" onClick={clearCheckedComp}>
              Clear
            </button>
          )}
        </div>
        <div className="form-grid">
          <label>
            Sold price
            <MoneyInput value={checkedCompPrice} onChange={setCheckedCompPrice} placeholder="e.g. 24.00" />
          </label>
          <label>
            Seen on
            <select
              value={checkedCompSource}
              onChange={(event) => setCheckedCompSource(event.target.value as CheckedCompSource)}
            >
              {checkedCompSources.map((source) => (
                <option key={source} value={source}>
                  {checkedCompSourceLabel(source)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>
            Sample
            <input
              inputMode="numeric"
              min="1"
              step="1"
              value={checkedCompSample}
              onChange={(event) => setCheckedCompSample(event.target.value)}
            />
          </label>
          <label>
            Note
            <input
              value={checkedCompNote}
              onChange={(event) => setCheckedCompNote(event.target.value)}
              placeholder="NM solds, same language"
            />
          </label>
        </div>
        {checkedComp && (
          <p className="hint">
            Auto list, buy plan and acquire are using this checked comp. API sources stay in the receipt.
          </p>
        )}
        {!checkedComp && variant === "priority" && (
          <p className="hint">
            Add one checked sold price and the stock button will use it for the buy plan and draft listing.
          </p>
        )}
      </div>
    );
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

          <section className="panel launch-plan-panel">
            <div className="panel-heading">
              <div>
                <h2>First week</h2>
                <span className="muted">{launchPlan.length} step{launchPlan.length === 1 ? "" : "s"}</span>
              </div>
              <button className="ghost-button" type="button" onClick={() => setView("pnl")}>
                Books
              </button>
            </div>
            <div className="launch-plan-list">
              {launchPlan.map((item) => (
                <LaunchPlanRow key={item.id} item={item} onOpen={openLaunchPlan} />
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
            {systemStatus ? (
              <div className="readiness-list" aria-label="Launch readiness">
                {launchReadiness.slice(0, 6).map((item) => (
                  <LaunchReadinessRow key={item.id} item={item} onOpen={openLaunchReadiness} />
                ))}
              </div>
            ) : (
              <p className="hint">Checking comp sources and setup...</p>
            )}
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
              <a className="export-link" href="/api/export/listing-pack" download>Listing pack</a>
            </div>
          </section>
        </section>
      )}

      {view === "acquire" && (
        <section className="workspace">
          <BuyFlowRail steps={buyFlowSteps} />
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
                alt={`${displayCardName} card art`}
              />
              <div>
                <span>Current card</span>
                <strong>{displayCardName}</strong>
                <small>
                  {displaySetName}
                  {displayNumber ? ` #${displayNumber}` : ""}
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
            <label className="quick-intake-field">
              Quick fill
              <div className="quick-intake-row quick-intake-actions">
                <input
                  value={quickIntake}
                  onChange={(event) => setQuickIntake(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && quickIntake.trim()) {
                      event.preventDefault();
                      applyQuickIntake({ lookupAfter: true });
                    }
                  }}
                  placeholder="Gengar lor tg TG06 raw £10 LP vinted binder"
                  autoComplete="off"
                />
                <button type="button" onClick={() => applyQuickIntake()} disabled={!quickIntake.trim()}>
                  Fill
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickIntake({ lookupAfter: true })}
                  disabled={!quickIntake.trim() || busy === "lookup"}
                >
                  Comp
                </button>
              </div>
            </label>
            <label className="set-field">
              Card
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setManualCompQuery("");
                  clearCheckedComp();
                }}
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
                  onChange={(event) => {
                    setSetNameValue(event.target.value);
                    setManualCompQuery("");
                    clearCheckedComp();
                  }}
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
                <input
                  value={number}
                  onChange={(event) => {
                    setNumber(event.target.value);
                    setManualCompQuery("");
                    clearCheckedComp();
                  }}
                  placeholder="199/165"
                />
              </label>
            </div>
            {recentSets.length > 0 && (
              <div className="set-chip-stack" aria-label="Recent sets">
                <span>Recent sets</span>
                <div className="set-chip-row recent-set-row">
                  {recentSets.map((set) => (
                    <button key={set.id} type="button" onClick={() => chooseSet(set)}>
                      {set.logoUrl || set.symbolUrl ? (
                        <img src={set.logoUrl ?? set.symbolUrl} alt="" onError={hideBrokenImage} />
                      ) : null}
                      <span>{set.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {popularSets.length > 0 && (
              <div className="set-chip-stack" aria-label="Popular sets">
                <span>Popular sets</span>
                <div className="set-chip-row">
                  {visiblePopularSets.map((set) => (
                    <button key={set.id} type="button" onClick={() => chooseSet(set)}>
                      {set.logoUrl || set.symbolUrl ? (
                        <img src={set.logoUrl ?? set.symbolUrl} alt="" onError={hideBrokenImage} />
                      ) : null}
                      <span>{set.name}</span>
                    </button>
                  ))}
                  {popularSets.length > VISIBLE_POPULAR_SET_LIMIT && (
                    <button
                      className="set-chip-more"
                      type="button"
                      onClick={() => setShowAllPopularSets((current) => !current)}
                    >
                      {showAllPopularSets ? "Fewer sets" : `${popularSets.length - VISIBLE_POPULAR_SET_LIMIT} more`}
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="grade-controls">
              <div className="segmented" role="group" aria-label="Quick grade">
                {quickGrades.map((g) => (
                  <button
                    key={g}
                    className={grade === g ? "selected" : ""}
                    type="button"
                    onClick={() => {
                      setGrade(g);
                      clearCheckedComp();
                    }}
                  >
                    {g.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
              <label className="grade-select-field">
                Grade
                <select
                  value={grade}
                  onChange={(event) => {
                    setGrade(event.target.value as Grade);
                    clearCheckedComp();
                  }}
                >
                  {gradeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="psa-lookup-field">
              PSA cert
              <div className="quick-intake-row">
                <input
                  inputMode="numeric"
                  value={graderCert}
                  onChange={(event) => setGraderCert(event.target.value)}
                  placeholder={grade === "RAW" ? "optional for slabs" : "cert number"}
                />
                <button
                  type="button"
                  onClick={verifyPsaCert}
                  disabled={busy === "psa" || !graderCert.trim()}
                >
                  {busy === "psa" ? "..." : "Verify"}
                </button>
              </div>
            </label>
            {psaResult && <PsaCertCard result={psaResult} />}
            <button className="primary-action" type="submit" disabled={busy === "lookup"}>
              {busy === "lookup" ? "Looking up..." : "Look up comp"}
            </button>
            {!headline && renderManualCompLinks("compact")}
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
                  {visibleQuickHunts.map((card) => (
                    <article className="quick-hunt-card" key={`${card.name}-${card.setName}-${card.number}`}>
                      <button
                        className="quick-hunt-pick"
                        type="button"
                        onClick={() => chooseQuickHunt(card, { lookupAfter: true })}
                        disabled={busy === "lookup"}
                      >
                        <span className="quick-art-stack">
                          <CardImage src={card.imageUrl} className="quick-card-art" fallbackClassName="quick-card-art blank" alt="" />
                          {card.setMarkUrl && (
                            <img className="quick-set-mark" src={card.setMarkUrl} alt="" onError={hideBrokenImage} />
                          )}
                        </span>
                        <span className="quick-hunt-copy">
                          <strong>{card.name}</strong>
                          <small>{card.setName} #{card.number}</small>
                        </span>
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
                  {quickHunts.length > VISIBLE_QUICK_HUNT_LIMIT && (
                    <button
                      className="quick-hunt-more ghost-button"
                      type="button"
                      onClick={() => setShowAllQuickHunts((current) => !current)}
                    >
                      {showAllQuickHunts ? "Fewer picks" : `${quickHunts.length - VISIBLE_QUICK_HUNT_LIMIT} more picks`}
                    </button>
                  )}
                </div>
              </>
            )}
          </form>

          {headline && (
            <section className="panel comp-panel" ref={compPanelRef}>
              <div className="comp-hero">
                <div>
                  <p className="eyebrow">
                    {needsManualComp
                      ? "manual comp required"
                      : headline.source === "manual-check"
                      ? checkedCompSourceLabel(headline.raw?.source)
                      : headline.source}
                  </p>
                  <h2>{needsManualComp ? "No auto price" : gbp(headline.medianPence)}</h2>
                </div>
                <span className={`pill ${confidenceLabel?.tone ?? ""}`}>{confidenceLabel?.label}</span>
              </div>
              {needsManualComp && (
                <div className="manual-rescue-card">
                  <div>
                    <span>Vintage, promos and odd variants</span>
                    <strong>Check solds, then enter the price</strong>
                  </div>
                  <ol>
                    <li>Open eBay UK solds with the exact typed wording.</li>
                    <li>Use same grade, edition, language and condition.</li>
                    <li>Enter the checked sold price below, then stock it.</li>
                  </ol>
                </div>
              )}
              {needsManualComp && renderManualCompLinks("priority")}
              {needsManualComp && renderCheckedCompCard("priority")}
              {!needsManualComp && deal && (
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
              {!needsManualComp && (
                <div className={`quick-stock-card ${buyPlan?.tone ?? "warn"}`}>
                  <div className="quick-stock-heading">
                    <div>
                      <span>Ready to stock</span>
                      <strong>{quickStockReady ? `${quickStockQuantity} to ${acquireListingState === "ACTIVE" ? "list" : "draft"}` : "Add cost"}</strong>
                    </div>
                    <span className={`pill ${buyPlan?.tone ?? "warn"}`}>{buyPlan?.label ?? "Check"}</span>
                  </div>
                  <div className="quick-stock-grid">
                    <label>
                      Cost
                      <MoneyInput value={cost} onChange={setCost} />
                    </label>
                    <label>
                      Qty
                      <input
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={quantity}
                        onChange={(event) => setQuantity(event.target.value)}
                      />
                    </label>
                    <Metric label="List" value={quickStockListPence > 0 ? gbp(quickStockListPence) : "auto"} />
                    <Metric
                      label="Profit"
                      value={buyPlan ? gbp(buyPlan.totalProfitPence) : "n/a"}
                      tone={buyPlan && buyPlan.totalProfitPence >= 0 ? "good" : "warn"}
                    />
                  </div>
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() => void acquire()}
                    disabled={busy === "acquire" || !quickStockReady}
                  >
                    {busy === "acquire" ? "Stocking..." : "Stock this"}
                  </button>
                </div>
              )}
              <div className="detail-grid">
                <Metric label="Range" value={`${gbp(headline.lowPence)}-${gbp(headline.highPence)}`} />
                <Metric label="Sample" value={`${headline.sampleSize} / ${headline.windowDays}d`} />
                <Metric label="Outliers" value={String(headline.outliersRemoved)} />
              </div>
              {dealerVerdict && (
                <div className={`dealer-verdict ${dealerVerdict.tone}`}>
                  <div>
                    <span>{dealerVerdict.label}</span>
                    <strong>{dealerVerdict.title}</strong>
                    <small>{dealerVerdict.detail}</small>
                  </div>
                  <div>
                    <span>Signals</span>
                    <strong>
                      {dealerVerdict.pricedSignalCount}/{dealerVerdict.totalSignalCount}
                    </strong>
                    <small>{dealerVerdict.spreadPct == null ? "single price" : `${dealerVerdict.spreadPct}% spread`}</small>
                  </div>
                </div>
              )}
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
              {!needsManualComp && renderManualCompLinks()}
              {!needsManualComp && renderCheckedCompCard()}
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
              {headline.raw?.kind === "checked-comp" && (
                <p className="hint">
                  Checked against {headline.raw.sourceLabel ?? checkedCompSourceLabel(headline.raw.source)}
                  {headline.raw.note ? ` · ${headline.raw.note}` : ""}.
                </p>
              )}
              {comp?.sourcesDisagree && !checkedComp && (
                <p className="hint danger-text">Sources disagree materially. Treat this as a check-before-buy price.</p>
              )}
              {comp?.sourcesDisagree && checkedComp && (
                <p className="hint danger-text">API sources disagree; the checked comp is driving this buy.</p>
              )}
            </section>
          )}

          {headline && grade === "RAW" && !needsManualComp && (
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

          {headline && !needsManualComp && (
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
              {buyTargetSuggestion && (
                <div className={`target-suggestion ${buyTargetSuggestion.alreadyUsing ? "active" : ""}`}>
                  <div>
                    <span>{buyTargetSuggestion.label}</span>
                    <strong>{gbp(buyTargetSuggestion.targetPence)}</strong>
                    <small>{buyTargetSuggestion.note}</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWatchTarget(penceToPounds(buyTargetSuggestion.targetPence))}
                    disabled={buyTargetSuggestion.alreadyUsing}
                  >
                    {buyTargetSuggestion.alreadyUsing ? "Using" : "Use"}
                  </button>
                </div>
              )}
              <button className="secondary-action" type="button" onClick={createWatch} disabled={busy === "watch-create"}>
                {busy === "watch-create" ? "Saving watch..." : "Watch for buy price"}
              </button>
            </section>
          )}

          <form className="panel" onSubmit={acquire}>
            <div className="panel-heading">
              <h2>Just bought it</h2>
              <span className="muted">Stock + listing</span>
            </div>
            <div className="form-grid">
              <label>
                Cost
                <MoneyInput value={cost} onChange={setCost} />
              </label>
              <label>
                Qty
                <input
                  id="quantity"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Strategy
                <select value={strategy} onChange={(event) => setStrategy(event.target.value as PricingStrategy)}>
                  <option value="quick">Quick</option>
                  <option value="market">Market</option>
                  <option value="patient">Patient</option>
                </select>
              </label>
              <label>
                Channel
                <select value={channel} onChange={(event) => setChannel(event.target.value as Channel)}>
                  {channels.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                List price
                <MoneyInput value={listPriceOverride} onChange={setListPriceOverride} placeholder="auto" />
              </label>
              <label>
                Listing
                <select value={acquireListingState} onChange={(event) => setAcquireListingState(event.target.value as AcquireListingState)}>
                  <option value="DRAFT">Draft</option>
                  <option value="ACTIVE">Active</option>
                </select>
              </label>
            </div>
            {projectedListSuggestion && !needsManualComp && (
              <div className={`price-preview ${projectedListSuggestion.confidence}`}>
                <div>
                  <span>Auto list</span>
                  <strong>{gbp(projectedListSuggestion.pricePence)}</strong>
                  <small>
                    {projectedListSuggestion.confidence}
                    {conditionAdjustmentActive ? " · condition adjusted" : ""}
                    {projectedListSuggestion.flooredToMargin ? " · margin floor" : ""}
                  </small>
                </div>
                <button type="button" onClick={() => setListPriceOverride(penceToPounds(projectedListSuggestion.pricePence))}>
                  Use
                </button>
              </div>
            )}
            {buyPlan && !needsManualComp && (
              <div className={`buy-plan ${buyPlan.tone}`}>
                <div className="buy-plan-heading">
                  <span>After {channelLabel(channel)}</span>
                  <strong>{buyPlan.label}</strong>
                  <small>{buyPlan.note}</small>
                </div>
                <div>
                  <span>Net/unit</span>
                  <strong>{gbp(buyPlan.unitNetPence)}</strong>
                  <small>
                    gross {gbp(buyPlan.unitGrossSalePence)} · fees {gbp(buyPlan.unitFeesPence)} · post{" "}
                    {gbp(buyPlan.unitPostagePence)}
                  </small>
                </div>
                <div>
                  <span>Profit</span>
                  <strong>{gbp(buyPlan.totalProfitPence)}</strong>
                  <small>{formatPct(buyPlan.roiPct)} ROI · {formatPct(buyPlan.marginPct)} margin</small>
                </div>
              </div>
            )}
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
            <div className="form-grid">
              <label>
                Condition
                <input value={condition} onChange={(event) => setCondition(event.target.value)} placeholder="NM, LP, edgewear..." />
              </label>
              <label>
                Cert
                <input
                  inputMode="numeric"
                  value={graderCert}
                  onChange={(event) => setGraderCert(event.target.value)}
                  placeholder={grade === "RAW" ? "optional" : "PSA cert number"}
                />
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
            <div className="preset-row" aria-label="Condition presets">
              {conditionPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={condition === preset ? "selected" : ""}
                  onClick={() => setCondition(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
            <label className="toggle-control">
              <input
                id="keep-buying"
                type="checkbox"
                checked={keepBuying}
                onChange={(event) => setKeepBuying(event.target.checked)}
              />
              <span>Keep buying</span>
            </label>
            <button className="primary-action" type="submit" disabled={busy === "acquire" || needsManualComp}>
              {busy === "acquire" ? "Stocking..." : needsManualComp ? "Add checked comp first" : "Acquire + price"}
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
          <form className="panel stock-import-panel" onSubmit={importStockRows}>
            <div className="panel-heading">
              <div>
                <h2>Opening stock</h2>
                <span className="muted">
                  {stockImportHasText
                    ? `${stockImportPreview.rows.length} row${stockImportPreview.rows.length === 1 ? "" : "s"} · ${gbp(stockImportPreview.totalCostPence)}`
                    : "Bulk stock"}
                </span>
              </div>
              {stockImportHasText && (
                <button className="ghost-button" type="button" onClick={() => setStockImportText("")}>
                  Clear
                </button>
              )}
            </div>
            <label>
              Paste rows
              <textarea
                value={stockImportText}
                onChange={(event) => setStockImportText(event.target.value)}
                placeholder={`card,set,number,grade,cost,qty,source,location,condition,cert,channel,list price,state\nGengar,Lost Origin Trainer Gallery,TG06/TG30,RAW,10.00,1,Card fair,Binder,NM,,Vinted,25.00,draft`}
                rows={4}
              />
            </label>
            {stockImportHasText && (
              <div className={`stock-import-preview ${stockImportPreview.errors.length > 0 ? "warn" : "good"}`}>
                {stockImportPreview.errors.length > 0 ? (
                  <div className="stock-import-errors">
                    {stockImportPreview.errors.slice(0, 4).map((row) => (
                      <span key={`${row.line}-${row.message}`}>
                        Line {row.line}: {row.message}
                      </span>
                    ))}
                    {stockImportPreview.errors.length > 4 && <span>+{stockImportPreview.errors.length - 4} more</span>}
                  </div>
                ) : (
                  <div className="stock-import-rows">
                    {stockImportPreview.rows.slice(0, 3).map((row, index) => (
                      <span key={`${row.card.name}-${row.card.number ?? ""}-${index}`}>
                        {row.quantity}x {row.card.name} · {row.card.setName ?? "No set"} · {gbp(row.costBasisPence)}
                        {row.condition ? ` · ${row.condition}` : ""}
                        {row.graderCert ? ` · cert ${row.graderCert}` : ""}
                        {row.listPricePence != null ? ` · list ${gbp(row.listPricePence)}` : ""}
                      </span>
                    ))}
                    {stockImportPreview.rows.length > 3 && <span>+{stockImportPreview.rows.length - 3} more</span>}
                  </div>
                )}
              </div>
            )}
            <button
              className="secondary-action"
              type="submit"
              disabled={
                busy === "stock-import" ||
                !stockImportHasText ||
                stockImportPreview.rows.length === 0 ||
                stockImportPreview.errors.length > 0
              }
            >
              {busy === "stock-import"
                ? "Importing..."
                : stockImportPreview.rows.length > 0
                  ? `Import ${stockImportPreview.rows.length} row${stockImportPreview.rows.length === 1 ? "" : "s"}`
                  : "Import rows"}
            </button>
          </form>
          {recentIntake.length > 0 && (
            <section className="panel recent-intake-panel">
              <div className="panel-heading">
                <div>
                  <h2>Recent buys</h2>
                  <span className="muted">{recentIntake.length} latest</span>
                </div>
                <strong>{gbp(recentIntakeCostPence)}</strong>
              </div>
              <div className="recent-intake-list">
                {recentIntake.map((item) => {
                  const listing = listingForInventoryItem(item);
                  return (
                    <article className="recent-intake-row" key={item.id}>
                      <CardImage src={item.card.imageUrl} className="mini-card-art" fallbackClassName="mini-card-art blank" alt="" />
                      <div className="recent-intake-copy">
                        <strong>{item.card.name}</strong>
                        <span>
                          {item.card.setName}
                          {item.card.number ? ` #${item.card.number}` : ""}
                          {" · "}
                          {item.quantity} @ {gbp(item.costBasis)}
                          {item.condition ? ` · ${item.condition}` : ""}
                          {item.graderCert ? ` · cert ${item.graderCert}` : ""}
                        </span>
                      </div>
                      <strong className="recent-intake-total">{gbp(item.costBasis * item.quantity)}</strong>
                      <div className="recent-intake-actions">
                        <button type="button" onClick={() => loadRecentBuy(item)}>
                          Again
                        </button>
                        <button type="button" onClick={() => loadRecentBuy(item, { lookupAfter: true })} disabled={busy === "lookup"}>
                          Comp
                        </button>
                        <button type="button" onClick={() => openRecentListingWork(item)}>
                          {listing ? "Pack" : "List"}
                        </button>
                        <button type="button" onClick={() => sellRecentBuy(item)} disabled={item.status === "SOLD"}>
                          Sell
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {headline && <div className="mobile-buy-spacer" aria-hidden="true" />}
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
                <button className="ghost-button" type="button" onClick={() => setView("acquire")}>
                  Add buy
                </button>
              </div>
              {firstDraftListingTarget?.item ? (
                <div className="listing-desk-card">
                  <CardImage
                    src={firstDraftListingTarget.item.card.imageUrl}
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
                    src={unlistedStock[0]?.card.imageUrl ?? null}
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
                <button className="ghost-button" type="button" onClick={() => setView("acquire")}>
                  Add buy
                </button>
              </div>
              <div className="listing-queue-list">
                {visibleUnlistedStock.slice(0, 6).map((item) => (
                  <ListingQueueRow
                    key={item.id}
                    item={item}
                    busy={busy}
                    onDraft={openListingCreator}
                    onEdit={openInventoryEditor}
                    onSell={openSell}
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
          {visibleListings.map((listing) => (
            <ListingRow
              key={listing.id}
              listing={listing}
              busy={busy}
              onEdit={openListingEditor}
              onPack={openListingPack}
              onSell={openSellFromListing}
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
          {listingPackTarget && listingPack && (
            <ListingPackSheet
              listing={listingPackTarget}
              pack={listingPack}
              copied={listingPackCopied}
              copiedField={listingPackCopiedField}
              busy={busy === `listing-${listingPackTarget.id}`}
              nextListingLabel={nextListingPackTarget ? listingQueueLabel(nextListingPackTarget) : null}
              onCopy={copyListingPack}
              onCopyField={copyListingPackField}
              onActivate={activateListingPackTarget}
              onSell={openSellFromListingPack}
              onNext={openNextListingPack}
              onClose={() => {
                setListingPackId(null);
                setListingPackCopied(false);
                setListingPackCopiedField(null);
              }}
            />
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
          <section className="panel cash-panel">
            <div className="panel-heading">
              <div>
                <h2>Cash position</h2>
                <span className="muted">stock + sales + costs</span>
              </div>
              <span className={`pill ${cashNetTone}`}>{gbp(cashNetPence)}</span>
            </div>
            <div className="detail-grid">
              <Metric label="Cash in" value={gbp(dashboard?.metrics.cashInPence ?? 0)} loading={dashboardLoading} />
              <Metric label="Cash out" value={gbp(dashboard?.metrics.cashOutPence ?? 0)} tone="warn" loading={dashboardLoading} />
              <Metric label="In stock" value={gbp(dashboard?.metrics.activeCostPence ?? 0)} loading={dashboardLoading} />
              <Metric
                label="Recovered"
                value={`${dashboard?.metrics.cashRecoveryPct ?? 0}%`}
                tone={(dashboard?.metrics.cashRecoveryPct ?? 0) >= 100 ? "good" : "warn"}
                loading={dashboardLoading}
              />
            </div>
            <div className="cash-breakdown">
              <span>sold stock {gbp(dashboard?.metrics.soldCostPence ?? 0)}</span>
              <span>fees {gbp(dashboard?.metrics.realizedFeesPence ?? 0)}</span>
              <span>postage {gbp(dashboard?.metrics.realizedPostagePence ?? 0)}</span>
              <span>costs {gbp(dashboard?.metrics.operatingExpensePence ?? 0)}</span>
            </div>
          </section>
          <section className="panel channel-panel">
            <div className="panel-heading">
              <div>
                <h2>Channel P&amp;L</h2>
                <span className="muted">where sales work</span>
              </div>
              <span className="pill">{dashboard?.metrics.channelBreakdown.length ?? 0} active</span>
            </div>
            {dashboard?.metrics.channelBreakdown.length ? (
              <div className="channel-list">
                {dashboard.metrics.channelBreakdown.map((row) => (
                  <article className={`channel-row ${row.profitPence >= 0 ? "good" : "warn"}`} key={row.channel}>
                    <div>
                      <strong>{channelLabel(row.channel)}</strong>
                      <span>
                        {row.saleCount} sale{row.saleCount === 1 ? "" : "s"} · avg {gbp(row.averageSalePence)}
                      </span>
                    </div>
                    <div>
                      <strong>{gbp(row.profitPence)}</strong>
                      <span>{row.marginPct == null ? "n/a" : `${row.marginPct}%`} margin</span>
                    </div>
                    <small>
                      revenue {gbp(row.revenuePence)} · fees {gbp(row.feesPence)} · postage {gbp(row.postagePence)}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState text="No channel data yet. Mark a sale from Stock and this will show which channel is working." />
            )}
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
                <strong>{watchDiscordReady ? "Push ready" : "In-app only"}</strong>
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
              {busy === "reprice" ? "Checking..." : "Check reprices"}
            </button>
            {repriceMessage && <p className="hint">{repriceMessage}</p>}
            {(repriceCheckedAt || discordReady !== null) && (
              <div className="alert-status">
                <span>{repriceCheckedAt ? `Checked ${ageLabel(repriceCheckedAt)}` : "Not checked"}</span>
                <strong>{discordReady ? "Push ready" : "In-app only"}</strong>
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
                <article className="mini-row sale-mini-row" key={sale.id}>
                  <div>
                    <strong>{sale.name} {sale.grade.replace(/_/g, " ")}</strong>
                    <span>
                      {shortDate(sale.soldAt)} · {channelLabel(sale.channel)} · sale {gbp(sale.salePricePence)}
                    </span>
                    <small>
                      fees {gbp(sale.feesPence)} · postage {gbp(sale.postagePence)} · cost {gbp(sale.costBasisPence)}
                    </small>
                  </div>
                  <div className="sale-result">
                    <strong>{gbp(sale.profitPence)}</strong>
                    <span>{sale.marginPct == null ? "n/a" : `${sale.marginPct}%`}</span>
                    <button
                      className="ghost-button sale-undo-button"
                      type="button"
                      onClick={() => requestUndoSale(sale)}
                      disabled={busy === `sale-${sale.id}`}
                    >
                      {busy === `sale-${sale.id}` ? "Undoing..." : "Undo"}
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <EmptyState text="No sales booked yet. Mark an item sold from Stock." />
            )}
          </section>
        </section>
      )}

      {sellingId && (
        <form className="sell-sheet" onSubmit={markSold}>
          <div className="panel-heading">
            <div>
              <h2>Mark sold</h2>
              {sellingItem && (
                <span className="muted">
                  {sellingItem.card.name} · cost {gbp(sellingItem.costBasis)} each · {sellingItem.quantity} in stock
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
          <div className="sale-shortcuts" aria-label="Sale shortcuts">
            <button type="button" onClick={useListingSalePrice} disabled={!sellingItem}>
              List + post
            </button>
            <button type="button" onClick={() => applySalePriceMultiplier(0.95)} disabled={!sellingItem}>
              95%
            </button>
            <button type="button" onClick={() => applySalePriceMultiplier(0.9)} disabled={!sellingItem}>
              90%
            </button>
            <button type="button" onClick={useBreakEvenSalePrice} disabled={!sellingItem}>
              Break even
            </button>
            {sellingItem && sellingItem.quantity > 1 && (
              <button type="button" onClick={sellAllQuantity}>
                All qty
              </button>
            )}
            <button type="button" onClick={applyCashSale}>
              Cash
            </button>
            <button type="button" onClick={resetSaleCosts}>
              Default costs
            </button>
            <button type="button" onClick={clearSalePostage}>
              Post £0
            </button>
          </div>
          <div className="form-grid">
            <label>
              Gross received
              <MoneyInput value={salePrice} onChange={setSalePrice} />
            </label>
            <label>
              Qty sold
              <input
                inputMode="numeric"
                min="1"
                max={sellingItem?.quantity ?? 1}
                step="1"
                value={saleQuantity}
                onChange={(event) => setSaleQuantity(event.target.value)}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Sold
              <input type="date" value={soldAt} onChange={(event) => setSoldAt(event.target.value)} />
            </label>
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
          </div>
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
          {sellingItem && buyerPaidPostagePence(saleChannel, sellingItem.grade) > 0 && (
            <p className="hint sale-assumption">
              Default gross includes {gbp(buyerPaidPostagePence(saleChannel, sellingItem.grade))} buyer-paid postage.
            </p>
          )}
          {salePreview && (
            <div className={`sale-preview ${salePreview.profitPence >= 0 ? "good" : "warn"}`}>
              <div>
                <span>Net</span>
                <strong>{gbp(salePreview.netPence)}</strong>
              </div>
              <div>
                <span>Cost</span>
                <strong>{gbp(salePreview.costPence)}</strong>
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

      {deleteTarget && (
        <section className="confirm-sheet" role="dialog" aria-modal="true" aria-label="Confirm delete">
          <div>
            <p className="eyebrow">{deleteTarget.kind === "sale" ? "Undo" : "Delete"}</p>
            <h2>{deleteTargetTitle(deleteTarget)}</h2>
            <span>{deleteTargetDetail(deleteTarget)}</span>
          </div>
          <div className="confirm-actions">
            <button className="ghost-button" type="button" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={confirmDeleteTarget}
              disabled={deleteTargetBusy(deleteTarget, busy)}
            >
              {deleteTargetButtonLabel(deleteTarget, busy)}
            </button>
          </div>
        </section>
      )}

      {view === "acquire" && headline && !needsManualComp && (
        <section className={`mobile-buy-action ${buyPlan?.tone ?? deal?.tone ?? "warn"}`} aria-label="Current buy action">
          <div>
            <span>{confidenceLabel?.label ?? "Comp"}</span>
            <strong>{gbp(headline.medianPence)}</strong>
            <small>
              {quickStockReady
                ? `${quickStockQuantity} @ ${gbp(quickStockCostPence)} · ${deal?.label ?? "ready"}`
                : "add cost and quantity"}
            </small>
          </div>
          <button
            className="primary-action"
            type="button"
            onClick={() => void acquire()}
            disabled={busy === "acquire" || !quickStockReady}
          >
            {busy === "acquire" ? "Stocking..." : quickStockReady ? "Stock" : "Add cost"}
          </button>
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

function BuyFlowRail({ steps }: { steps: BuyFlowStep[] }) {
  return (
    <section className="buy-flow-rail" aria-label="Buy workflow">
      {steps.map((step, index) => (
        <div className={`buy-flow-step ${step.state}`} key={step.label}>
          <span>{index + 1}</span>
          <div>
            <strong>{step.label}</strong>
            <small>{step.detail || "ready"}</small>
          </div>
        </div>
      ))}
    </section>
  );
}

function PsaCertCard({ result }: { result: PsaCertView }) {
  return (
    <div className={`psa-cert-card ${result.found ? "good" : "warn"}`}>
      {result.found ? (
        <>
          <div className="psa-cert-heading">
            <div>
              <span>PSA cert {result.certNumber}{result.live ? "" : " · demo"}</span>
              <strong>{toTitleCase(result.subject ?? "Unknown card")}</strong>
              <small>
                {[result.year, result.brand ? toTitleCase(result.brand) : null, result.cardNumber ? `#${result.cardNumber}` : null]
                  .filter(Boolean)
                  .join(" · ")}
                {result.variety ? ` · ${toTitleCase(result.variety)}` : ""}
              </small>
            </div>
            <span className="pill good">{result.gradeLabel ?? result.grade?.replace(/_/g, " ")}</span>
          </div>
          <div className="psa-cert-pop">
            <Metric label="Pop at grade" value={result.totalPopulation != null ? String(result.totalPopulation) : "-"} />
            <Metric label="Pop higher" value={result.populationHigher != null ? String(result.populationHigher) : "-"} />
          </div>
          <p className="hint">Verified slab details are filling the buy form.</p>
        </>
      ) : (
        <p className="hint">{result.reason ?? "Cert not found."}</p>
      )}
    </div>
  );
}

function ListingPackSheet({
  listing,
  pack,
  copied,
  copiedField,
  busy,
  nextListingLabel,
  onCopy,
  onCopyField,
  onActivate,
  onSell,
  onNext,
  onClose,
}: {
  listing: Listing;
  pack: ListingPack;
  copied: boolean;
  copiedField: string | null;
  busy: boolean;
  nextListingLabel: string | null;
  onCopy: () => void;
  onCopyField: (field: ListingPackCopyField) => void;
  onActivate: () => void;
  onSell: (listing: Listing) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const item = listing.item;
  const specifics = Object.entries(pack.itemSpecifics);
  const copyFields = listingPackCopyFields(pack);
  const venueAction = listingVenueAction(listing.channel);
  const canActivate = listing.state === "DRAFT";
  const canSell = Boolean(item && item.status !== "SOLD" && listing.state !== "SOLD");

  return (
    <form className="sell-sheet listing-pack-sheet" onSubmit={(event) => event.preventDefault()}>
      <div className="panel-heading">
        <div>
          <h2>Listing pack</h2>
          <span className="muted">
            {channelLabel(listing.channel)}
            {item ? ` · ${item.card.name} · ${item.grade.replace(/_/g, " ")}` : ""}
          </span>
        </div>
        <button className="ghost-button" type="button" onClick={onClose}>Close</button>
      </div>
      <div className="listing-pack-summary">
        <div>
          <span>Title</span>
          <strong>{pack.title}</strong>
        </div>
        <div>
          <span>Price</span>
          <strong>{gbp(pack.suggestedPricePence)}</strong>
        </div>
        <div>
          <span>Postage</span>
          <strong>{gbp(pack.postage.pricePence)}</strong>
        </div>
      </div>
      <div className="listing-field-actions" aria-label="Copy listing fields">
        {copyFields.map((field) => (
          <button
            key={field.key}
            className={copiedField === field.key ? "selected" : ""}
            type="button"
            onClick={() => onCopyField(field)}
          >
            {copiedField === field.key ? `${field.label} copied` : `Copy ${field.label}`}
          </button>
        ))}
      </div>
      <div className="listing-pack-specifics">
        {specifics.map(([label, value]) => (
          <span key={label}>
            <strong>{label}</strong>
            {value}
          </span>
        ))}
      </div>
      <label>
        Copy block
        <textarea readOnly value={pack.copyReady} rows={9} />
      </label>
      <div className="listing-pack-actions">
        <button className="primary-action" type="button" onClick={onCopy}>
          {copied ? "Copied" : "Copy listing pack"}
        </button>
        {venueAction && (
          <a className="export-link" href={venueAction.url} target="_blank" rel="noreferrer">
            {venueAction.label}
          </a>
        )}
        {canActivate && (
          <button className="ghost-button" type="button" onClick={onActivate} disabled={busy}>
            {busy ? "Activating..." : "Mark active"}
          </button>
        )}
        {canSell && (
          <button className="ghost-button listing-pack-sale-action" type="button" onClick={() => onSell(listing)} disabled={busy}>
            Record sale
          </button>
        )}
        {nextListingLabel && (
          <button className="ghost-button" type="button" onClick={onNext}>
            Next: {nextListingLabel}
          </button>
        )}
      </div>
    </form>
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
  const stockNotes = [item.condition, item.graderCert ? `cert ${item.graderCert}` : null, item.location]
    .filter(Boolean)
    .join(" · ");
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
          {stockNotes && <p>{stockNotes}</p>}
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

function ListingQueueRow({
  item,
  busy,
  onDraft,
  onEdit,
  onSell,
}: {
  item: InventoryItem;
  busy: string | null;
  onDraft: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
  onSell: (item: InventoryItem) => void;
}) {
  const stockNotes = [item.condition, item.graderCert ? `cert ${item.graderCert}` : null, item.location]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="item-row listing-queue-row">
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
        {stockNotes && <p>{stockNotes}</p>}
        <div className="row-actions">
          <button
            type="button"
            onClick={() => onDraft(item)}
            disabled={busy?.startsWith("create-listing-") || busy?.startsWith("listing-")}
          >
            Draft
          </button>
          <button type="button" onClick={() => onSell(item)} disabled={busy?.startsWith("sell-")}>
            Sell
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
  onEdit,
  onPack,
  onSell,
  onState,
}: {
  listing: Listing;
  busy: string | null;
  onEdit: (listing: Listing) => void;
  onPack: (listing: Listing) => void;
  onSell: (listing: Listing) => void;
  onState: (state: Exclude<ListingState, "SOLD">) => void;
}) {
  const card = listing.item?.card;
  const title = listing.title ?? card?.name ?? "Untitled listing";
  const price = listing.listPrice ?? listing.suggestedPrice ?? 0;
  const isBusy = busy === `listing-${listing.id}`;
  const canSell = Boolean(listing.item && listing.item.status !== "SOLD" && listing.state !== "SOLD");
  const stockNotes = [
    listing.item?.condition,
    listing.item?.graderCert ? `cert ${listing.item.graderCert}` : null,
  ].filter(Boolean).join(" · ");

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
          {stockNotes ? ` · ${stockNotes}` : ""}
          {listing.externalUrl ? " · URL saved" : ""}
        </p>
        <p>{gbp(price)}</p>
        <div className="row-actions">
          <button type="button" onClick={() => onEdit(listing)} disabled={isBusy || listing.state === "SOLD"}>
            Edit
          </button>
          {listing.item && (
            <button type="button" onClick={() => onPack(listing)} disabled={isBusy}>
              Pack
            </button>
          )}
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
          {canSell && (
            <button type="button" onClick={() => onSell(listing)} disabled={Boolean(busy?.startsWith("sell-"))}>
              Sell
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function deleteTargetTitle(target: DeleteTarget): string {
  if (target.kind === "inventory") return target.item.card.name;
  if (target.kind === "sale") return target.sale.name;
  return target.watch.card.name;
}

function deleteTargetDetail(target: DeleteTarget): string {
  if (target.kind === "inventory") {
    return `${target.item.grade.replace(/_/g, " ")} stock row, listing drafts and sale records will be removed.`;
  }
  if (target.kind === "sale") {
    return `${target.sale.grade.replace(/_/g, " ")} ${channelLabel(target.sale.channel)} sale will be removed and one copy restored to Stock. Listings stay closed until you relist.`;
  }
  return `${target.watch.grade.replace(/_/g, " ")} buy watch and its alerts will be removed.`;
}

function deleteTargetBusy(target: DeleteTarget, busy: string | null): boolean {
  if (target.kind === "inventory") return busy === `delete-${target.item.id}`;
  if (target.kind === "sale") return busy === `sale-${target.sale.id}`;
  return busy === `watch-${target.watch.id}`;
}

function deleteTargetButtonLabel(target: DeleteTarget, busy: string | null): string {
  if (target.kind === "sale") return busy === `sale-${target.sale.id}` ? "Undoing..." : "Undo sale";
  return busy?.startsWith("delete-") || busy?.startsWith("watch-") ? "Deleting..." : "Delete";
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
        {source.setupHint && <small>{source.setupHint}</small>}
      </div>
      <span>{sourceStatusLabel(source.status)}</span>
    </div>
  );
}

function LaunchReadinessRow({
  item,
  onOpen,
}: {
  item: LaunchReadinessItem;
  onOpen: (target: LaunchReadinessTarget | undefined) => void;
}) {
  const actionable = Boolean(item.action && item.target && item.target !== "external");
  return (
    <div className={`readiness-row ${item.state}`}>
      <span aria-hidden="true">{readinessSymbol(item.state)}</span>
      <div>
        <strong>{item.title}</strong>
        <small>{item.detail}</small>
      </div>
      {item.action ? (
        actionable ? (
          <button type="button" onClick={() => onOpen(item.target)}>{item.action}</button>
        ) : (
          <small className="readiness-action">{item.action}</small>
        )
      ) : null}
    </div>
  );
}

function LaunchPlanRow({
  item,
  onOpen,
}: {
  item: LaunchPlanItem;
  onOpen: (target: LaunchPlanTarget) => void;
}) {
  const actionable = item.target !== "external";
  return (
    <div className={`launch-plan-row ${item.state}`}>
      <span aria-hidden="true">{launchPlanSymbol(item.state)}</span>
      <div>
        <strong>{item.title}</strong>
        <small>{item.detail}</small>
      </div>
      {actionable ? (
        <button type="button" onClick={() => onOpen(item.target)}>{item.action}</button>
      ) : (
        <small className="readiness-action">{item.action}</small>
      )}
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
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <span className="money-input">
      <span aria-hidden="true">£</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
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
  channel: Channel,
  grade: Grade,
  condition: string | null | undefined,
): {
  label: string;
  tone: "good" | "warn" | "danger";
  expectedProfitPence: number;
  targetBuyPence: number;
} {
  if (comp.sampleSize === 0 || comp.medianPence <= 0) {
    return { label: "No signal", tone: "danger", expectedProfitPence: 0, targetBuyPence: 0 };
  }
  const adjustedCompPence = conditionAdjustedPricePence(comp.medianPence, grade, condition);
  const grossSalePence = defaultGrossSalePence(channel, adjustedCompPence, { grade });
  const costs = estimateSaleCosts(channel, grossSalePence, { grade });
  const net = grossSalePence - costs.feesPence - costs.postagePence;
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

function saleListPrice(item: InventoryItem): number | null {
  const listing =
    item.listings.find((row) => row.state === "ACTIVE") ??
    item.listings.find((row) => row.state === "DRAFT") ??
    item.listings[0];
  return listing?.listPrice ?? listing?.suggestedPrice ?? null;
}

function gradeTone(grade: string): string {
  if (grade === "RAW") return "raw";
  if (grade.startsWith("PSA")) return "psa";
  if (grade.startsWith("BGS")) return "bgs";
  if (grade.startsWith("CGC")) return "cgc";
  if (grade.startsWith("ACE")) return "ace";
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
    source === "manual-check"
      ? "Checked comp"
      : source === "pokemon-price-tracker"
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
  if (result.sampleSize === 0 || result.medianPence <= 0) return rawReason(result) ?? "No matching signal";
  if (result.raw?.kind === "checked-comp") {
    return `${result.raw.sourceLabel ?? checkedCompSourceLabel(result.raw.source)} checked price`;
  }
  if (result.source === "owned-sales") return "Your sold prices";
  if (result.source === "poketrace") {
    const raw = result.raw as { priceSource?: string; tier?: string; kind?: string; market?: string } | undefined;
    const source =
      raw?.priceSource === "tcgplayer"
        ? "TCGPlayer"
        : raw?.priceSource === "ebay"
          ? "eBay"
          : raw?.priceSource === "cardmarket"
            ? "Cardmarket"
            : "PokeTrace";
    const market = raw?.market ? ` ${raw.market}` : "";
    const tier = raw?.tier ? raw.tier.replace(/_/g, " ") : result.grade.replace(/_/g, " ");
    return raw?.kind === "market-baseline" ? `${source}${market} ${tier} baseline` : `${source}${market} ${tier} aggregate`;
  }
  if (result.raw?.kind === "catalog-market-baseline") {
    return result.raw.chosenSignal?.label ?? "TCGPlayer/Cardmarket baseline";
  }
  if (result.raw?.chosenPriceSource === "smartMarketPrice") {
    const confidence = result.raw.smartMarketPrice?.confidence;
    return confidence ? `Smart RAW · ${confidence}` : "Smart RAW";
  }
  return `${result.grade.replace(/_/g, " ")} sold aggregate`;
}

function compMeta(result: CompResult): string {
  const reason = rawReason(result);
  if ((result.sampleSize === 0 || result.medianPence <= 0) && reason) return reason;
  const sample =
    result.source === "pokemon-tcg-market"
      ? "baseline"
      : `${result.sampleSize} sample${result.sampleSize === 1 ? "" : "s"}`;
  return `${sample} / ${result.windowDays}d · ${ageLabel(result.asOf)}`;
}

function rawReason(result: CompResult): string | null {
  return typeof result.raw?.reason === "string" && result.raw.reason.trim() ? result.raw.reason : null;
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

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bEx\b/g, "ex")
    .replace(/\bGx\b/g, "GX")
    .replace(/\bVmax\b/g, "VMAX")
    .replace(/\bVstar\b/g, "VSTAR")
    .trim();
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

function readinessSymbol(state: LaunchReadinessItem["state"]): string {
  if (state === "done") return "✓";
  if (state === "warn") return "!";
  return "›";
}

function launchPlanSymbol(state: LaunchPlanItem["state"]): string {
  if (state === "done") return "✓";
  if (state === "warn") return "!";
  return "›";
}

function channelLabel(channel: Channel): string {
  if (channel === "EBAY") return "eBay";
  if (channel === "CARDMARKET") return "Cardmarket";
  if (channel === "VINTED") return "Vinted";
  return "In person";
}

function listingQueueLabel(listing: Listing): string {
  const item = listing.item;
  if (!item) return listing.title ?? "draft";
  return [item.card.name, item.card.number].filter(Boolean).join(" ");
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

function formatPct(value: number | null): string {
  return value == null ? "n/a" : `${value.toFixed(1).replace(/\.0$/, "")}%`;
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
