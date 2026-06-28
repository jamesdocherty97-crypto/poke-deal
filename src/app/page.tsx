"use client";

import { forwardRef, type FormEvent, type SyntheticEvent, type TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  conditionAdjustedPricePence,
  rawConditionPriceFactor,
  suggestListPrice,
  type PricingStrategy,
} from "@/lib/comps/pricing";
import { GRADE_VALUES, type CompResult as DomainCompResult, type Grade as DomainGrade } from "@/lib/domain/types";
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
import {
  parseRecentComps,
  pinRecentComp,
  recentCompKey,
  removeRecentComp,
  serializeRecentComps,
  type RecentCompEntry,
} from "@/lib/dealer/recentComps";
import { buildDealerCompVerdict, type DealerCompVerdict } from "@/lib/dealer/compVerdict";
import { judgeDeal } from "@/lib/dealer/dealJudge";
import {
  buildManualCompLinks,
  buildManualCompFallbackQuery,
  cardSearchQuery,
  normalizeManualCompSearchText,
  type ManualCompLinkKind,
} from "@/lib/dealer/compLinks";
import { buildListingDraftDefaults } from "@/lib/dealer/listingDraft";
import { normalizeListingUrl } from "@/lib/dealer/listingUrl";
import { buildLaunchReadiness, type LaunchReadinessItem, type LaunchReadinessTarget } from "@/lib/dealer/launchReadiness";
import { buildLaunchPlan, buildLaunchProgress, type LaunchPlanItem, type LaunchPlanTarget, type LaunchProgress } from "@/lib/dealer/launchPlan";
import { buildBuyPlan, buildBuyTargetOptions, buildBuyTargetSuggestion } from "@/lib/dealer/buyPlan";
import { splitTotalCostToUnitPence } from "@/lib/dealer/bundleCost";
import {
  buildCheckedComp,
  checkedCompSourceLabel,
  parseCheckedCompPriceText,
  type CheckedCompSource,
} from "@/lib/dealer/checkedComp";
import {
  buildListingPack,
  listingPackCopyFields,
  type ListingPack,
  type ListingPackCopyField,
} from "@/lib/dealer/listingPack";
import { buildListingEconomics } from "@/lib/dealer/listingEconomics";
import {
  buildListingSellFlow,
  buildListingNextAction,
  listingVenueAction,
  nextDraftListingId,
  nextSaleListingId,
  type ListingNextAction,
  type ListingFlowStep,
} from "@/lib/dealer/listingWorkflow";
import { parseQuickIntake } from "@/lib/dealer/intakeParser";
import { buildQuickIntakePreview } from "@/lib/dealer/intakePreview";
import { buildOperatingSnapshot, type OperatingSnapshotRow } from "@/lib/dealer/operatingSnapshot";
import { parseStockImportText } from "@/lib/dealer/stockImport";
import {
  DEFAULT_INTAKE_PREFERENCES,
  nextIntakeFormAfterStock,
  parseIntakePreferences,
  parseIntakeQuantity,
  serializeIntakePreferences,
} from "@/lib/dealer/intakeSession";
import { pullRefreshDistance, pullRefreshProgress, shouldTriggerPullRefresh } from "@/lib/dealer/pullRefresh";
import { buildSalePreview } from "@/lib/dealer/unitSale";
import { buildSalePrompt, type SalePrompt } from "@/lib/dealer/salePrompt";
import { checkEbayReadiness } from "@/lib/ebay/readiness";
import { buildPsaLookupFields } from "@/lib/psa/lookupFields";
import {
  acceptedOfferItemSubtotalPence,
  buyerPaidPostagePence,
  breakEvenSalePricePence,
  defaultGrossSalePence,
  discountedItemSubtotalPence,
  estimateSaleCosts,
  grossSalePriceForProfitPence,
  grossSalePriceForNetPence,
  rescaleGrossSaleForQuantity,
  salePriceBreakdown,
  saleItemSubtotalPence,
} from "@/lib/dealer/saleFees";
import { inventorySwipeAction, inventorySwipeOffset } from "@/lib/dealer/swipeActions";
import { buildTodayActions, type TodayAction, type TodayActionTarget } from "@/lib/dealer/today";
import { textMentionsFirstEdition } from "@/lib/comps/variants";
import { normalizeCatalogCardSearchInput, shouldOfferTypedCardFallback } from "@/lib/catalog/cardSearch";
import type { CatalogCard, CatalogPriceSignal } from "@/lib/catalog/types";

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

type LastStockedCard = {
  itemId: string;
  listingId: string | null;
  name: string;
  setName: string;
  number: string;
  grade: Grade;
  quantity: number;
  costPence: number;
  listPricePence: number;
  channel: Channel;
  listingState: ListingState;
  imageUrl: string | null;
};

type OwnedSaleCompRow = {
  id: string;
  itemId: string;
  salePricePence: number;
  itemSubtotalPence?: number;
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
  alternatives?: CatalogCard[];
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
  externalRef: string | null;
  externalUrl: string | null;
  suggestedPrice: number | null;
  listPrice: number | null;
  createdAt: string;
  listedAt: string | null;
  endedAt: string | null;
  item?: InventoryItem;
};

type EbayStatus = {
  configured: boolean;
  connected: boolean;
  env?: string;
  marketplaceId?: string;
  hasPolicies?: boolean;
  hasMerchantLocation?: boolean;
  policies?: {
    paymentPolicyId?: string;
    fulfillmentPolicyId?: string;
    returnPolicyId?: string;
    merchantLocationKey?: string | null;
  };
  locationSetup?: {
    configured: boolean;
    missingFields?: string[];
    merchantLocationKey?: string | null;
  };
  error?: string;
};

type EbayPreflight = {
  listingId: string;
  writesToEbay: boolean;
  existingOfferId: string | null;
  sku: string;
  title: string;
  priceGbp: string;
  quantity: number;
  marketplaceId: string;
  categoryId: string;
  hasImage: boolean;
  policyKeys: {
    paymentPolicyId: boolean;
    fulfillmentPolicyId: boolean;
    returnPolicyId: boolean;
    merchantLocationKey: boolean;
  };
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

const quickGrades: Grade[] = [
  "RAW",
  "PSA_8",
  "PSA_9",
  "PSA_10",
  "ACE_9",
  "ACE_10",
  "BGS_7_5",
  "BGS_8_5",
  "BGS_9_5",
  "CGC_1_5",
  "CGC_8_5",
  "CGC_9_5",
  "CGC_10",
];
const gradeOptions: Grade[] = [...GRADE_VALUES];
const channels: Channel[] = ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"];
const checkedCompSources: CheckedCompSource[] = ["EBAY_SOLD", "CARDMARKET", "TCGPLAYER", "OTHER"];
const checkedCompSampleOptions = ["1", "2", "3", "5"];
const expenseCategories: ExpenseCategory[] = ["SUPPLIES", "POSTAGE", "GRADING", "TABLE_FEE", "TRAVEL", "PLATFORM", "OTHER"];
const editableStatuses: ItemStatus[] = ["IN_STOCK", "LISTED", "RESERVED"];
const QUICK_HUNTS_STORAGE_KEY = "pokemon-dealer-os.quick-hunts.v1";
const RECENT_SETS_STORAGE_KEY = "pokemon-dealer-os.recent-sets.v1";
const RECENT_COMPS_STORAGE_KEY = "pokemon-dealer-os.recent-comps.v1";
const INTAKE_PREFERENCES_STORAGE_KEY = "pokemon-dealer-os.intake-preferences.v1";
const sourcePresets = ["Card fair", "Facebook", "eBay", "Cardmarket", "Vinted", "Whatnot", "Collection", "Trade-in"];
const locationPresets = ["Box A", "Box B", "Binder", "To list", "Slabs", "Singles"];
const conditionPresets = ["NM", "LP", "MP", "HP", "DMG"];
const STOCK_IMPORT_EXAMPLE =
  "card,set,number,grade,cost,qty,source,location,condition,cert,channel,list price,state\n" +
  "Gengar,Lost Origin Trainer Gallery,TG06/TG30,RAW,10.00,1,Card fair,Binder,NM,,Vinted,25.00,draft";
const stockImportTemplates = [
  {
    label: "CSV",
    text: STOCK_IMPORT_EXAMPLE,
  },
  {
    label: "Binder",
    text: "2x Gengar lor tg TG06 raw £10 LP vinted binder list on ebay draft",
  },
  {
    label: "Slab",
    text: "Charizard ex 151 199/165 PSA 10 £700 cert 84213567 slabs list on ebay draft",
  },
] as const;
const VISIBLE_POPULAR_SET_LIMIT = 30;
const VISIBLE_QUICK_HUNT_LIMIT = 8;
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
  const [view, setView] = useState<View>("acquire");
  const [name, setName] = useState("");
  const [setNameValue, setSetNameValue] = useState("");
  const [number, setNumber] = useState("");
  const [quickIntake, setQuickIntake] = useState("");
  const [manualCompQuery, setManualCompQuery] = useState("");
  const [stockImportText, setStockImportText] = useState("");
  const [grade, setGrade] = useState<Grade>("RAW");
  const [cost, setCost] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [source, setSource] = useState(DEFAULT_INTAKE_PREFERENCES.source);
  const [location, setLocation] = useState(DEFAULT_INTAKE_PREFERENCES.location);
  const [condition, setCondition] = useState(DEFAULT_INTAKE_PREFERENCES.condition);
  const [graderCert, setGraderCert] = useState("");
  const [psaResult, setPsaResult] = useState<PsaCertView | null>(null);
  const [strategy, setStrategy] = useState<PricingStrategy>(DEFAULT_INTAKE_PREFERENCES.strategy as PricingStrategy);
  const [channel, setChannel] = useState<Channel>(DEFAULT_INTAKE_PREFERENCES.channel as Channel);
  const [listPriceOverride, setListPriceOverride] = useState("");
  const [checkedCompPrice, setCheckedCompPrice] = useState("");
  const [checkedCompSample, setCheckedCompSample] = useState("1");
  const [checkedCompSource, setCheckedCompSource] = useState<CheckedCompSource>("EBAY_SOLD");
  const [checkedCompNote, setCheckedCompNote] = useState("");
  const [manualCompReturnArmed, setManualCompReturnArmed] = useState(false);
  const [acquireListingState, setAcquireListingState] = useState<AcquireListingState>(DEFAULT_INTAKE_PREFERENCES.listingState);
  const [shouldCreateListing, setShouldCreateListing] = useState(false);
  const [keepBuying, setKeepBuying] = useState(DEFAULT_INTAKE_PREFERENCES.keepBuying);
  const [comp, setComp] = useState<Reconciled | null>(null);
  const [stockCompItemId, setStockCompItemId] = useState<string | null>(null);
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
  const [sellingListingId, setSellingListingId] = useState<string | null>(null);
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
  const [lastStocked, setLastStocked] = useState<LastStockedCard | null>(null);
  const [ebayStatus, setEbayStatus] = useState<EbayStatus | null>(null);
  const [ebayPreflight, setEbayPreflight] = useState<EbayPreflight | null>(null);
  const [ebayPublishTarget, setEbayPublishTarget] = useState<string | null>(null);
  const [ebayLocationName, setEbayLocationName] = useState("Pokemon Dealer OS");
  const [ebayLocationAddress1, setEbayLocationAddress1] = useState("");
  const [ebayLocationAddress2, setEbayLocationAddress2] = useState("");
  const [ebayLocationCity, setEbayLocationCity] = useState("");
  const [ebayLocationPostcode, setEbayLocationPostcode] = useState("");
  const [ebayLocationCountry, setEbayLocationCountry] = useState("GB");
  const [cardArtUrl, setCardArtUrl] = useState<string | null>(null);
  const [gradeComp, setGradeComp] = useState<CompResult | null>(null);
  const [gradeOdds, setGradeOdds] = useState("45");
  const [gradingCost, setGradingCost] = useState("19.99");
  const [popularSets, setPopularSets] = useState<CatalogSet[]>([]);
  const [allSets, setAllSets] = useState<CatalogSet[]>([]);
  const [showAllPopularSets, setShowAllPopularSets] = useState(false);
  const [showAllQuickHunts, setShowAllQuickHunts] = useState(false);
  const [scrollToComp, setScrollToComp] = useState(false);
  const [scrollToStockImport, setScrollToStockImport] = useState(false);
  const [setSuggestions, setSetSuggestions] = useState<CatalogSet[]>([]);
  const [setSuggestionsOpen, setSetSuggestionsOpen] = useState(false);
  const [cardSuggestions, setCardSuggestions] = useState<CatalogCard[]>([]);
  const [cardSuggestionsOpen, setCardSuggestionsOpen] = useState(false);
  const [cardSuggestionsLoading, setCardSuggestionsLoading] = useState(false);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventorySort, setInventorySort] = useState<InventorySort>("newest");
  const [listingQuery, setListingQuery] = useState("");
  const [listingStateFilter, setListingStateFilter] = useState<ListingStateFilter>("ALL");
  const [listingSort, setListingSort] = useState<ListingSort>("newest");
  const [quickHunts, setQuickHunts] = useState<QuickHuntCard[]>(DEFAULT_QUICK_HUNTS);
  const [recentSetIds, setRecentSetIds] = useState<string[]>([]);
  const [recentComps, setRecentComps] = useState<RecentCompEntry[]>([]);
  const [intakePreferencesLoaded, setIntakePreferencesLoaded] = useState(false);
  const pullStartY = useRef<number | null>(null);
  const pullTracking = useRef(false);
  const compPanelRef = useRef<HTMLElement | null>(null);
  const checkedCompRef = useRef<HTMLDivElement | null>(null);
  const quickIntakeRef = useRef<HTMLInputElement | null>(null);
  const costInputRef = useRef<HTMLInputElement | null>(null);
  const stockImportDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const stockImportRef = useRef<HTMLFormElement | null>(null);
  const stockImportTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const expensePanelRef = useRef<HTMLElement | null>(null);
  const expenseDescriptionRef = useRef<HTMLInputElement | null>(null);
  const pnlWatchPanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void refreshAll();
    void loadSetCatalog();
    void fetch("/api/ebay/status")
      .then((r) => r.json() as Promise<EbayStatus>)
      .then(setEbayStatus)
      .catch(() => setEbayStatus({ configured: false, connected: false }));
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
    try {
      setRecentComps(parseRecentComps(window.localStorage.getItem(RECENT_COMPS_STORAGE_KEY)));
    } catch {
      setRecentComps([]);
    }
  }, []);

  useEffect(() => {
    try {
      const preferences = parseIntakePreferences(window.localStorage.getItem(INTAKE_PREFERENCES_STORAGE_KEY));
      setSource(preferences.source);
      setLocation(preferences.location);
      setCondition(preferences.condition);
      setChannel(preferences.channel as Channel);
      setStrategy(preferences.strategy as PricingStrategy);
      setAcquireListingState(preferences.listingState);
      setKeepBuying(preferences.keepBuying);
    } catch {
      setSource(DEFAULT_INTAKE_PREFERENCES.source);
      setLocation(DEFAULT_INTAKE_PREFERENCES.location);
      setCondition(DEFAULT_INTAKE_PREFERENCES.condition);
      setChannel(DEFAULT_INTAKE_PREFERENCES.channel as Channel);
      setStrategy(DEFAULT_INTAKE_PREFERENCES.strategy as PricingStrategy);
      setAcquireListingState(DEFAULT_INTAKE_PREFERENCES.listingState);
      setKeepBuying(DEFAULT_INTAKE_PREFERENCES.keepBuying);
    } finally {
      setIntakePreferencesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!intakePreferencesLoaded) return;
    try {
      window.localStorage.setItem(
        INTAKE_PREFERENCES_STORAGE_KEY,
        serializeIntakePreferences({
          source,
          location,
          condition,
          channel,
          strategy,
          listingState: acquireListingState,
          keepBuying,
        }),
      );
    } catch {
      // Device storage is optional; the current session still keeps these defaults.
    }
  }, [
    acquireListingState,
    channel,
    condition,
    intakePreferencesLoaded,
    keepBuying,
    location,
    source,
    strategy,
  ]);

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
    const smartText = quickIntake.trim() || [name.trim(), number.trim()].filter(Boolean).join(" ");
    const parsed = normalizeCatalogCardSearchInput(smartText, setNameValue);
    const query = parsed.query;
    setCardSuggestions([]);
    if (!query) {
      setCardSuggestionsLoading(false);
      return;
    }
    setCardSuggestionsLoading(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      const qs = new URLSearchParams({ q: query, limit: "8" });
      if (parsed.setName ?? setNameValue.trim()) qs.set("set", parsed.setName ?? setNameValue.trim());
      fetch(`/api/catalog/cards?${qs}`)
        .then(readJson)
        .then((payload) => {
          if (!cancelled) {
            setCardSuggestions(payload.cards ?? []);
            setCardSuggestionsLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCardSuggestions([]);
            setCardSuggestionsLoading(false);
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [name, number, quickIntake, setNameValue, cardSuggestionsOpen]);

  const sellingItem = useMemo(
    () => inventory.find((item) => item.id === sellingId) ?? null,
    [inventory, sellingId],
  );
  const sellingListing = useMemo(
    () => listings.find((listing) => listing.id === sellingListingId) ?? null,
    [listings, sellingListingId],
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
  const stockCompItem = useMemo(
    () => inventory.find((item) => item.id === stockCompItemId && item.status !== "SOLD") ?? null,
    [inventory, stockCompItemId],
  );
  const stockCompListing = useMemo(() => {
    if (!stockCompItem) return null;
    const listing = listingForInventoryItem(stockCompItem);
    if (!listing || (listing.state !== "DRAFT" && listing.state !== "ACTIVE")) return null;
    return listing;
  }, [stockCompItem, listings]);
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
  const firstSaleListingTarget = useMemo(() => {
    const nextId = nextSaleListingId(listings, null);
    return nextId ? listings.find((listing) => listing.id === nextId) ?? null : null;
  }, [listings]);
  const nextSaleAfterCurrentTarget = useMemo(() => {
    if (!sellingListingId) return null;
    const nextId = nextSaleListingId(listings, sellingListingId);
    return nextId ? listings.find((listing) => listing.id === nextId) ?? null : null;
  }, [listings, sellingListingId]);
  const nextListingPackTarget = useMemo(() => {
    const nextId = nextDraftListingId(visibleListings, listingPackId);
    return nextId ? visibleListings.find((listing) => listing.id === nextId) ?? null : null;
  }, [listingPackId, visibleListings]);
  const listingPack = useMemo(() => {
    if (!listingPackTarget?.item) return null;
    const { item } = listingPackTarget;
    const savedListPrice = listingPackTarget.listPrice ?? listingPackTarget.suggestedPrice ?? undefined;
    return buildListingPack({
      channel: listingPackTarget.channel,
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
    if (soldQuantity <= 0) return null;
    return buildSalePreview({
      salePricePence: poundsToPence(salePrice),
      feesPence: poundsToPence(fees),
      postagePence: poundsToPence(postage),
      unitCostPence: sellingItem.costBasis,
      soldQuantity,
    });
  }, [fees, postage, salePrice, saleQuantity, sellingItem]);
  const salePrompt = useMemo(
    () =>
      buildSalePrompt({
        salePricePence: poundsToPence(salePrice),
        netPence: salePreview?.netPence ?? null,
        profitPence: salePreview?.profitPence ?? null,
        soldQuantity: salePreview?.soldQuantity ?? parseIntakeQuantity(saleQuantity) ?? 1,
        nextSaleAvailable: Boolean(nextSaleAfterCurrentTarget),
      }),
    [nextSaleAfterCurrentTarget, salePreview?.netPence, salePreview?.profitPence, salePreview?.soldQuantity, salePrice, saleQuantity],
  );
  const saleBreakdown = useMemo(() => {
    if (!sellingItem) return null;
    const soldQuantity = parseIntakeQuantity(saleQuantity) ?? 0;
    if (soldQuantity <= 0) return null;
    return salePriceBreakdown(saleChannel, poundsToPence(salePrice), soldQuantity, { grade: sellingItem.grade });
  }, [saleChannel, salePrice, saleQuantity, sellingItem]);
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
  const sourceMatchedCard = !catalogCard && apiHeadline?.card ? apiHeadline.card : null;
  const sourceMatchTypedMeta = [name.trim(), setNameValue.trim(), number.trim() ? `#${number.trim()}` : ""]
    .filter(Boolean)
    .join(" · ");
  const sourceMatchSourceLabel = apiHeadline ? sourceLabel(apiHeadline.source, false) : "Source";
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
  const parsedQuickIntake = useMemo(
    () => (quickIntake.trim() ? parseQuickIntake(quickIntake) : null),
    [quickIntake],
  );
  const quickIntakePreview = useMemo(
    () =>
      parsedQuickIntake
        ? buildQuickIntakePreview(parsedQuickIntake, {
            currentName: name,
            currentSetName: setNameValue,
            currentNumber: number,
            currentGrade: grade.replace(/_/g, " "),
            currentCost: cost,
            currentQuantity: quantity,
            currentSource: source,
            currentLocation: location,
            currentCondition: condition,
            currentChannel: channel,
            currentListingState: acquireListingState,
          })
        : null,
    [acquireListingState, channel, condition, cost, grade, location, name, number, parsedQuickIntake, quantity, setNameValue, source],
  );
  const typedFallbackSuggestion = useMemo(() => {
    if (!quickIntake.trim() || !parsedQuickIntake?.name || cardSuggestionsLoading) return null;
    if (
      !shouldOfferTypedCardFallback(
        {
          name: parsedQuickIntake.name,
          setName: parsedQuickIntake.setName ?? setNameValue.trim(),
          number: parsedQuickIntake.number,
        },
        cardSuggestions,
      )
    ) {
      return null;
    }
    return {
      name: parsedQuickIntake.name,
      setName: parsedQuickIntake.setName ?? setNameValue.trim(),
      number: parsedQuickIntake.number,
      grade: parsedQuickIntake.grade ?? grade,
    };
  }, [cardSuggestions, cardSuggestionsLoading, grade, parsedQuickIntake, quickIntake, setNameValue]);
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
  const selectedCardTitle = displayCardName.trim() || "Next card";
  const selectedCardMeta = [
    displaySetName.trim() || null,
    displayNumber ? `#${displayNumber}` : displayCardName.trim() && displaySetName.trim() ? "manual identity" : null,
    grade.replace(/_/g, " "),
  ].filter(Boolean).join(" · ");
  const matchingQuickHunt = quickHunts.find(
    (card) =>
      card.name.trim().toLowerCase() === name.trim().toLowerCase() &&
      card.setName.trim().toLowerCase() === setNameValue.trim().toLowerCase() &&
      card.number.trim().toLowerCase() === number.trim().toLowerCase(),
  );
  const hasActiveCardIdentity = Boolean(name.trim() || setNameValue.trim() || number.trim() || comp);
  const hasBuyContext = Boolean(hasActiveCardIdentity || quickIntake.trim() || parsedQuickIntake?.name || checkedComp);
  const canClearCurrentComp = Boolean(
    hasActiveCardIdentity ||
      quickIntake.trim() ||
      cost.trim() ||
      manualCompQuery.trim() ||
      checkedCompPrice.trim() ||
      graderCert.trim() ||
      psaResult,
  );
  const canRunSmartComp = Boolean(quickIntake.trim() || name.trim());
  const selectedCardImage = cardArtUrl ?? catalogCard?.imageUrl ?? matchingQuickHunt?.imageUrl ?? null;
  const selectedCardMarkUrl = setMarkUrl ?? matchingQuickHunt?.setMarkUrl ?? null;
  const spotlightImage =
    selectedCardImage ??
    (hasActiveCardIdentity
      ? null
      : activeInventory.find((item) => item.card.imageUrl)?.card.imageUrl ??
        listings.find((listing) => listing.item?.card.imageUrl)?.item?.card.imageUrl ??
        quickHunts[0]?.imageUrl ??
        null);
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
  const quickIntakeManualQuery = useMemo(() => normalizeManualCompSearchText(quickIntake), [quickIntake]);
  const typedManualCompContext = useMemo(
    () => [quickIntakeManualQuery, name, setNameValue, number].filter(Boolean).join(" "),
    [name, number, quickIntakeManualQuery, setNameValue],
  );
  const manualCompFallbackQuery = useMemo(
    () => buildManualCompFallbackQuery(manualCompCard, { condition, typedText: typedManualCompContext }),
    [condition, manualCompCard, typedManualCompContext],
  );
  const manualCompSearchText = manualCompQuery || quickIntakeManualQuery;
  const manualCompLinks = useMemo(
    () => buildManualCompLinks(manualCompCard, grade, { searchText: manualCompSearchText, condition, typedText: typedManualCompContext }),
    [condition, grade, manualCompCard, manualCompSearchText, typedManualCompContext],
  );
  const compSpreadPct = useMemo(() => (compForReceipt ? medianSpreadPct(compForReceipt.all) : null), [compForReceipt]);
  const dealerVerdict = useMemo(
    () => (checkedComp ? null : compForReceipt ? buildDealerCompVerdict(compForReceipt) : null),
    [checkedComp, compForReceipt],
  );
  const shouldOfferManualComp = Boolean(
    headline &&
      !checkedComp &&
      (needsManualComp || !catalogCard || comp?.sourcesDisagree || (dealerVerdict && dealerVerdict.tone !== "good")),
  );
  const requiresCheckedCompBeforeStock = Boolean(!checkedComp && dealerVerdict?.requiresCheckedComp);
  const stockButtonLabel = checkedComp
    ? "Stock checked comp"
    : dealerVerdict && dealerVerdict.tone !== "good"
      ? "Stock with caution"
      : "Stock this";
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
  const stockCompSuggestion = useMemo(
    () =>
      headline && stockCompItem
        ? suggestListPrice({
            comp: headline,
            strategy,
            costBasisPence: stockCompItem.costBasis,
            condition: stockCompItem.condition,
          })
        : null,
    [headline, stockCompItem, strategy],
  );
  const conditionAdjustmentActive = grade === "RAW" && rawConditionPriceFactor(grade, condition) < 1;
  const conditionAdjustedHeadlinePence =
    headline && conditionAdjustmentActive ? conditionAdjustedPricePence(headline.medianPence, grade, condition) : null;
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
  const manualStockReady = Boolean(name.trim() && quickStockQuantity > 0 && quickStockCostPence > 0);
  const totalCostSplit = useMemo(
    () =>
      quickStockQuantity > 1 && quickStockCostPence > 0
        ? splitTotalCostToUnitPence(quickStockCostPence, quickStockQuantity)
        : null,
    [quickStockCostPence, quickStockQuantity],
  );
  const quickStockReady = Boolean(headline && quickStockQuantity > 0 && quickStockCostPence > 0 && quickStockListPence > 0);
  const quickStockCanSubmit = quickStockReady && !requiresCheckedCompBeforeStock;
  const mobileNeedsCheckedComp = needsManualComp || requiresCheckedCompBeforeStock;
  const mobileCanStockLater = mobileNeedsCheckedComp && manualStockReady;
  const acquireButtonLabel = busy === "acquire"
    ? "Stocking..."
    : !headline
      ? "Look up comp first"
      : !quickStockReady
        ? "Add cost"
        : requiresCheckedCompBeforeStock
          ? "Add checked comp first"
          : "Acquire + price";
  const quickOfferOptions = useMemo(() => {
    const targetPence = deal?.targetBuyPence ?? 0;
    const options: Array<{ label: string; valuePence: number }> = [];
    if (targetPence > 0) {
      options.push({ label: "Target", valuePence: targetPence });
      options.push({ label: "Safe", valuePence: Math.max(1, Math.round(targetPence * 0.9)) });
    }
    if (quickStockListPence > 0) {
      options.push({ label: "Half list", valuePence: Math.max(1, Math.round(quickStockListPence * 0.5)) });
    }
    const seen = new Set<number>();
    return options.filter((option) => {
      if (seen.has(option.valuePence)) return false;
      seen.add(option.valuePence);
      return true;
    });
  }, [deal?.targetBuyPence, quickStockListPence]);
  const checkedCompPriceOptions = useMemo(() => {
    if (!apiHeadline || apiHeadline.medianPence <= 0) return [];
    const options = [
      { label: "Use comp", valuePence: apiHeadline.medianPence },
      ...(apiHeadline.lowPence > 0 && apiHeadline.lowPence !== apiHeadline.medianPence
        ? [{ label: "Low", valuePence: apiHeadline.lowPence }]
        : []),
      ...(apiHeadline.highPence > 0 && apiHeadline.highPence !== apiHeadline.medianPence
        ? [{ label: "High", valuePence: apiHeadline.highPence }]
        : []),
    ];
    const seen = new Set<number>();
    return options.filter((option) => {
      if (seen.has(option.valuePence)) return false;
      seen.add(option.valuePence);
      return true;
    });
  }, [apiHeadline]);
  const buyTargetSuggestion = useMemo(
    () =>
      headline
        ? buildBuyTargetSuggestion({
            targetBuyPence: deal?.targetBuyPence ?? null,
            compMedianPence: headline.medianPence,
            compLowPence: headline.lowPence,
            currentTargetPence: poundsToPence(watchTarget),
          })
        : null,
    [deal?.targetBuyPence, headline, watchTarget],
  );
  const buyTargetOptions = useMemo(
    () =>
      headline
        ? buildBuyTargetOptions({
            targetBuyPence: deal?.targetBuyPence ?? null,
            compMedianPence: headline.medianPence,
            compLowPence: headline.lowPence,
            currentTargetPence: poundsToPence(watchTarget),
          })
        : [],
    [deal?.targetBuyPence, headline, watchTarget],
  );
  const buyFlowSteps = useMemo<BuyFlowStep[]>(() => {
    const cardReady = Boolean(name.trim() && (setNameValue.trim() || number.trim()));
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
          : "card + set/number",
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
    number,
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

  useEffect(() => {
    if (!scrollToStockImport || view !== "acquire" || !stockImportRef.current) return;
    const handle = window.setTimeout(() => {
      if (stockImportDetailsRef.current) stockImportDetailsRef.current.open = true;
      stockImportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      stockImportTextareaRef.current?.focus();
      setScrollToStockImport(false);
    }, 90);
    return () => window.clearTimeout(handle);
  }, [scrollToStockImport, view]);

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
  const ebayPolicies = ebayStatus?.policies;
  const ebayHasPolicies = Boolean(
    ebayStatus?.hasPolicies ||
      (ebayPolicies?.paymentPolicyId && ebayPolicies.fulfillmentPolicyId && ebayPolicies.returnPolicyId),
  );
  const ebayHasMerchantLocation = Boolean(ebayStatus?.hasMerchantLocation || ebayPolicies?.merchantLocationKey);
  const ebayNeedsMerchantLocation = Boolean(ebayStatus?.connected && ebayHasPolicies && !ebayHasMerchantLocation);
  const ebayLocationFormReady = Boolean(
    ebayLocationAddress1.trim() &&
      ebayLocationCity.trim() &&
      ebayLocationPostcode.trim() &&
      ebayLocationCountry.trim().length === 2,
  );
  const ebayNeedsReconnect = Boolean(
    ebayStatus?.configured &&
      !ebayStatus.connected &&
      ebayStatus.error &&
      /(?:invalid access token|authorization|refresh token|token exchange|token refresh)/i.test(ebayStatus.error),
  );
  const ebayHealthSource = useMemo<SystemSource>(
    () => ({
      id: "ebay-sell-api",
      label: "eBay Sell API",
      role: "listing offer automation",
      status: ebayStatus?.connected && ebayHasPolicies && ebayHasMerchantLocation
        ? "ready"
        : ebayStatus?.connected && ebayHasPolicies
          ? "building"
          : ebayStatus?.connected
            ? "building"
            : "missing",
      required: false,
      setupHint:
        ebayStatus?.connected && ebayHasPolicies && ebayHasMerchantLocation
          ? "Seller account and business policies are ready for app-created offers."
          : ebayStatus?.connected && ebayHasPolicies
            ? "Required eBay policies are ready; no merchant location key was returned, so first offer creation may need seller-location setup."
          : ebayStatus?.connected
            ? "Seller account is connected; finish business policies before offer creation."
            : ebayNeedsReconnect
              ? "The saved eBay connection has expired. Reconnect the seller account to create offers."
            : ebayStatus?.configured
              ? "Seller credentials are present; connect the eBay account to create offers."
              : "Add production eBay credentials when you are ready to automate listing offers.",
    }),
    [ebayHasMerchantLocation, ebayHasPolicies, ebayNeedsReconnect, ebayStatus?.configured, ebayStatus?.connected],
  );
  const setupSources = useMemo(
    () => (systemStatus ? [...systemStatus.sources.filter((source) => source.id !== "push-alerts"), ebayHealthSource] : []),
    [ebayHealthSource, systemStatus],
  );
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
        operatingExpensePence: dashboard?.metrics.operatingExpensePence ?? 0,
      }),
    [
      activeInventory.length,
      activeListingCount,
      activeWatchCount,
      dashboard?.metrics.agedStockCount,
      dashboard?.metrics.operatingExpensePence,
      dashboard?.metrics.soldCount,
      dashboard?.metrics.stockCount,
      draftListingCount,
      soldInventory.length,
      unlistedStockCount,
    ],
  );
  const operatingSnapshot = useMemo<OperatingSnapshotRow[]>(
    () =>
      buildOperatingSnapshot({
        activeCostPence: dashboard?.metrics.activeCostPence ?? 0,
        cashInPence: dashboard?.metrics.cashInPence ?? 0,
        cashOutPence: dashboard?.metrics.cashOutPence ?? 0,
        cashNetPence: dashboard?.metrics.cashNetPence ?? 0,
        cashRecoveryPct: dashboard?.metrics.cashRecoveryPct ?? 0,
        sellThroughPct: dashboard?.metrics.sellThroughPct ?? 0,
        draftListings: draftListingCount,
        activeListings: activeListingCount,
      }),
    [
      activeListingCount,
      dashboard?.metrics.activeCostPence,
      dashboard?.metrics.cashInPence,
      dashboard?.metrics.cashNetPence,
      dashboard?.metrics.cashOutPence,
      dashboard?.metrics.cashRecoveryPct,
      dashboard?.metrics.sellThroughPct,
      draftListingCount,
    ],
  );
  const launchReadiness = useMemo(
    () =>
      systemStatus
        ? buildLaunchReadiness({
            livePrimaryComps: systemStatus.summary.livePrimaryComps,
            liveCatalogKey: systemStatus.summary.liveCatalogKey,
            secondaryCrossCheck: systemStatus.summary.secondaryCrossCheck,
            ebayConfigured: Boolean(ebayStatus?.configured),
            ebayConnected: Boolean(ebayStatus?.connected),
            ebayHasPolicies,
            ebayHasMerchantLocation,
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
      ebayHasPolicies,
      ebayHasMerchantLocation,
      ebayStatus?.configured,
      ebayStatus?.connected,
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
  const launchProgress = useMemo(
    () =>
      buildLaunchProgress({
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
  const primaryTodayAction = todayActions[0] ?? null;

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
    if (target === "opening-stock") {
      openOpeningStockImport();
      return;
    }
    if (target === "stock") {
      setInventoryQuery("");
      setInventorySort("newest");
      setView("inventory");
      return;
    }
    if (target === "drafts") {
      openListingDesk();
      return;
    }
    if (target === "sales") {
      openSalesDesk();
      return;
    }
    if (target === "watches") {
      openBuyWatchesPanel();
      return;
    }
    if (target === "reprice") {
      setView("pnl");
      void checkReprices();
      return;
    }
    setView("pnl");
  }

  function openCostsPanel() {
    setView("pnl");
    window.setTimeout(() => {
      expensePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      expenseDescriptionRef.current?.focus();
    }, 90);
  }

  function openBuyWatchesPanel() {
    setView("pnl");
    window.setTimeout(() => {
      pnlWatchPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 90);
  }

  function openSalesDesk() {
    setListingStateFilter("ACTIVE");
    setListingSort("newest");
    setView("listings");
    if (firstSaleListingTarget) {
      openSellFromListing(firstSaleListingTarget);
    }
  }

  function openLaunchReadiness(target: LaunchReadinessTarget | undefined) {
    if (!target || target === "external") return;
    if (target === "ebay-connect") {
      window.location.href = "/api/ebay/connect";
      return;
    }
    if (target === "opening-stock") {
      openOpeningStockImport();
      return;
    }
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
      openListingDesk();
      return;
    }
    setView("pnl");
  }

  function openLaunchPlan(target: LaunchPlanTarget) {
    if (target === "external") return;
    if (target === "opening-stock") {
      openOpeningStockImport({ example: true });
      return;
    }
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
      openListingDesk();
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
    setManualCompReturnArmed(false);
  }

  function clearCompEvidence() {
    setComp(null);
    setStockCompItemId(null);
    setSuggestion(null);
    setCardArtUrl(null);
    setGradeComp(null);
    setListPriceOverride("");
    clearCheckedComp();
  }

  function editCompIdentity() {
    clearCompEvidence();
    setQuickIntake("");
    setManualCompQuery("");
  }

  function clearCurrentComp(message = "Ready for next comp.") {
    setName("");
    setSetNameValue("");
    setNumber("");
    setQuickIntake("");
    setManualCompQuery("");
    setCost("");
    setQuantity("1");
    clearCompEvidence();
    setGraderCert("");
    setPsaResult(null);
    setError(null);
    setNotice(message);
    window.requestAnimationFrame(() => quickIntakeRef.current?.focus());
  }

  function skipCurrentComp() {
    clearCurrentComp("Skipped. Ready for next comp.");
  }

  function openOpeningStockImport(options: { example?: boolean } = {}) {
    setView("acquire");
    if (options.example && !stockImportText.trim()) {
      setStockImportText(STOCK_IMPORT_EXAMPLE);
      setNotice("Example stock row loaded. Replace it with your own rows.");
    }
    setScrollToStockImport(true);
  }

  function rememberRecentComp(payload: Reconciled, input: LookupInput) {
    const result = payload.headline;
    if (!result) return;
    const verdict = buildDealerCompVerdict(payload);
    const confidence = { label: verdict.label, tone: verdict.tone };
    const catalog = payload.catalog;
    const entry: RecentCompEntry = {
      name: catalog?.name ?? input.name,
      setName: catalog?.setName ?? input.setName,
      ...(catalog?.number ?? input.number ? { number: catalog?.number ?? input.number } : {}),
      grade: result.grade ?? input.grade,
      pricePence: result.medianPence,
      lowPence: result.lowPence,
      highPence: result.highPence,
      sampleSize: result.sampleSize,
      windowDays: result.windowDays,
      source: result.source,
      confidenceLabel: confidence.label,
      confidenceTone: confidence.tone,
      ...(catalog?.imageUrl ? { imageUrl: catalog.imageUrl } : {}),
      ...(catalog?.setLogoUrl || catalog?.setSymbolUrl ? { setMarkUrl: catalog.setLogoUrl ?? catalog.setSymbolUrl } : {}),
      lookedUpAt: result.asOf,
    };

    setRecentComps((current) => {
      const next = pinRecentComp(current, entry);
      try {
        window.localStorage.setItem(RECENT_COMPS_STORAGE_KEY, serializeRecentComps(next));
      } catch {
        // Recent comps are a device convenience; the live lookup still works.
      }
      return next;
    });
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
    setPsaResult(null);
    window.requestAnimationFrame(() => quickIntakeRef.current?.focus());
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
    if (parsed.channel) {
      setChannel(parsed.channel as Channel);
      filled.push("channel");
    }
    if (parsed.listingState) {
      setAcquireListingState(parsed.listingState);
      setShouldCreateListing(true);
      filled.push("listing");
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

  function runSmartComp() {
    if (quickIntake.trim()) {
      applyQuickIntake({ lookupAfter: true });
      return;
    }
    void lookupComp({ name, setName: setNameValue, number, grade });
  }

  async function lookup(event?: FormEvent) {
    event?.preventDefault();
    await lookupComp({ name, setName: setNameValue, number, grade });
  }

  function normalizeLookupInput(input: LookupInput): LookupInput {
    const parsed = normalizeCatalogCardSearchInput(
      [input.name.trim(), input.number.trim()].filter(Boolean).join(" "),
      input.setName,
    );

    return {
      name: parsed.name || input.name,
      setName: parsed.setName ?? input.setName,
      number: parsed.number ?? input.number,
      grade: input.grade,
    };
  }

  function applyNormalizedLookupFields(input: LookupInput) {
    if (input.name !== name) setName(input.name);
    if (input.setName !== setNameValue) {
      setSetNameValue(input.setName);
      pinRecentSetName(input.setName);
    }
    if (input.number !== number) setNumber(input.number);
  }

  async function lookupComp(input: LookupInput) {
    const normalizedInput = normalizeLookupInput(input);
    applyNormalizedLookupFields(normalizedInput);
    setBusy("lookup");
    setError(null);
    setNotice(null);
    setSuggestion(null);
    clearCheckedComp();
    try {
      const qs = new URLSearchParams({
        name: normalizedInput.name,
        set: normalizedInput.setName,
        number: normalizedInput.number,
        grade: normalizedInput.grade,
      });
      const res = await fetch(`/api/comps?${qs}`);
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "lookup failed");
      setComp(payload);
      setCardArtUrl(payload.catalog?.imageUrl ?? null);
      pinRecentSetName(payload.catalog?.setName ?? normalizedInput.setName);
      rememberRecentComp(payload, normalizedInput);
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
      clearCompEvidence();
      const lookupFields = buildPsaLookupFields(result);
      if (lookupFields.name) setName(lookupFields.name);
      if (lookupFields.setName) {
        setSetNameValue(lookupFields.setName);
        pinRecentSetName(lookupFields.setName);
      }
      if (lookupFields.number) setNumber(lookupFields.number);
      if (lookupFields.grade) setGrade(lookupFields.grade);
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
          createListing: shouldCreateListing,
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
      const acquiredComps = payload.comps ?? (payload.comp ? { headline: payload.comp, all: [payload.comp], sourcesDisagree: false } : null);
      if (acquiredComps) {
        const rememberedComps = { ...acquiredComps, catalog: acquiredComps.catalog ?? payload.catalog ?? null };
        setComp(rememberedComps);
        rememberRecentComp(rememberedComps, { name, setName: setNameValue, number, grade });
      }
      if (payload.catalog?.imageUrl) setCardArtUrl(payload.catalog.imageUrl);
      pinRecentSetName(payload.catalog?.setName ?? setNameValue);
      const listedPence = payload.listing?.listPrice ?? payload.listing?.suggestedPrice ?? payload.suggestion.pricePence;
      const listingVerb = payload.listing
        ? payload.listing.state === "ACTIVE" ? "Listed" : "Drafted"
        : "Not listed";
      setLastStocked({
        itemId: payload.item.id,
        listingId: payload.listing?.id ?? null,
        name: payload.catalog?.name ?? name,
        setName: payload.catalog?.setName ?? setNameValue,
        number: payload.catalog?.number ?? number,
        grade,
        quantity: intakeQuantity,
        costPence: poundsToPence(cost),
        listPricePence: listedPence,
        channel,
        listingState: payload.listing?.state ?? "DRAFT",
        imageUrl: payload.catalog?.imageUrl ?? cardArtUrl,
      });
      setNotice(
        `${intakeQuantity > 1 ? `${intakeQuantity} copies stocked` : "Stocked"}. ${
          payload.listing ? `${listingVerb} at ${gbp(listedPence)}.` : "Listing skipped."
        }`,
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

      let createdListing: Listing | null = null;
      if (shouldCreateListing && payload.item?.id) {
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
          createdListing = listingPayload.listing as Listing;
        }
      }

      const stockedItem = payload.item as InventoryItem | undefined;
      setLastStocked({
        itemId: stockedItem?.id ?? payload.item?.id,
        listingId: createdListing?.id ?? null,
        name: stockedItem?.card?.name ?? name,
        setName: stockedItem?.card?.setName ?? setNameValue,
        number: stockedItem?.card?.number ?? number,
        grade,
        quantity: intakeQuantity,
        costPence: costBasisPence,
        listPricePence: createdListing?.listPrice ?? createdListing?.suggestedPrice ?? overrideListPricePence ?? draftDefaults.listPricePence,
        channel,
        listingState: createdListing?.state ?? acquireListingState,
        imageUrl: stockedItem?.card?.imageUrl ?? cardArtUrl,
      });
      setNotice(
        createdListing
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
    let firstCreatedListingId: string | null = null;
    let firstCreatedListingState: ListingStateFilter = "DRAFT";

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

        if (stockPayload.item?.id) {
          const draftDefaults = buildListingDraftDefaults({
            card: { name: row.card.name, number: row.card.number },
            grade: row.grade,
            costBasis: row.costBasisPence,
          });
          const listingRes = await fetch("/api/listings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              itemId: stockPayload.item.id,
              channel: row.channel ?? channel,
              state: row.listingState ?? "DRAFT",
              listPricePence: row.listPricePence ?? draftDefaults.listPricePence,
            }),
          });
          const listingPayload = await readJson(listingRes);
          if (!listingRes.ok) {
            console.warn("[stock import] listing skipped:", listingPayload.error ?? "listing create failed");
          } else {
            listingsCreated += 1;
            if (!firstCreatedListingId) {
              firstCreatedListingId = listingPayload.listing?.id ?? null;
              firstCreatedListingState = listingPayload.listing?.state === "ACTIVE" ? "ACTIVE" : "DRAFT";
            }
          }
        }
      }

      setStockImportText("");
      setNotice(
        `Imported ${stocked} stock row${stocked === 1 ? "" : "s"}${listingsCreated > 0 ? ` and ${listingsCreated} listing${listingsCreated === 1 ? "" : "s"}` : ""}.`,
      );
      await refreshAll();
      if (firstCreatedListingId) {
        setListingStateFilter(firstCreatedListingState);
        setListingSort("newest");
        setListingPackId(firstCreatedListingId);
        setListingPackCopied(false);
        setListingPackCopiedField(null);
        setEbayPreflight(null);
        setView("listings");
      } else {
        setView("inventory");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "stock import failed");
    } finally {
      setBusy(null);
    }
  }

  async function pasteStockImportRows() {
    let clipboardText = "";
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      setError("Clipboard read failed. Paste rows into the box manually.");
      return;
    }

    if (!clipboardText.trim()) {
      setError("Clipboard is empty.");
      return;
    }

    const parsed = parseStockImportText(clipboardText);
    setStockImportText(clipboardText);
    setNotice(
      parsed.rows.length > 0
        ? `${parsed.rows.length} stock row${parsed.rows.length === 1 ? "" : "s"} ready to review.`
        : "Rows pasted. Fix the highlighted import issues before saving.",
    );
    setError(parsed.errors.length > 0 ? `${parsed.errors.length} import row${parsed.errors.length === 1 ? "" : "s"} need fixing.` : null);
  }

  function fillStockImportTemplate(template: (typeof stockImportTemplates)[number]) {
    setStockImportText(template.text);
    setNotice(`${template.label} stock template loaded.`);
    setError(null);
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
    clearCompEvidence();
    setQuickIntake(cardIdentitySearchText({ name: card.name, setName: card.setName, number: card.number }, grade));
    setName(card.name);
    setSetNameValue(card.setName);
    setNumber(card.number);
    setCardArtUrl(card.imageUrl ?? null);
    setManualCompQuery("");
    setNotice(null);
    setError(null);
    if (options.lookupAfter) {
      setNotice(`Looking up ${card.name}...`);
      void lookupComp(nextLookup);
    }
  }

  function chooseRecentComp(entry: RecentCompEntry, options: { lookupAfter?: boolean } = {}) {
    const nextGrade = gradeOptions.includes(entry.grade as Grade) ? (entry.grade as Grade) : "RAW";
    const nextLookup = {
      name: entry.name,
      setName: entry.setName,
      number: entry.number ?? "",
      grade: nextGrade,
    };

    setView("acquire");
    clearCompEvidence();
    setQuickIntake(cardIdentitySearchText({ name: entry.name, setName: entry.setName, number: entry.number }, nextGrade));
    setName(entry.name);
    setSetNameValue(entry.setName);
    setNumber(entry.number ?? "");
    setGrade(nextGrade);
    setCardArtUrl(entry.imageUrl ?? null);
    setManualCompQuery(
      cardSearchQuery(
        { name: entry.name, setName: entry.setName, number: entry.number },
        { condition },
      ),
    );
    setError(null);

    if (options.lookupAfter) {
      setNotice(`Rechecking ${entry.name}...`);
      void lookupComp(nextLookup);
      return;
    }

    setNotice(`${entry.name} loaded.`);
  }

  function chooseCatalogAlternative(card: CatalogCard) {
    const firstEditionRequested =
      textMentionsFirstEdition(manualCompSearchText) ||
      textMentionsFirstEdition(name) ||
      textMentionsFirstEdition(setNameValue) ||
      textMentionsFirstEdition(number);
    const lookupName =
      firstEditionRequested && !textMentionsFirstEdition(card.name)
        ? `${card.name} 1st Edition`
        : card.name;
    const normalizedCondition = condition.trim().toUpperCase();
    const conditionSearchTerm = normalizedCondition && normalizedCondition !== "NM" ? condition : "";
    const manualSearch = normalizeManualCompSearchText(
      [
        card.name,
        card.number ?? "",
        card.setName,
        firstEditionRequested ? "1st Edition" : "",
        conditionSearchTerm,
      ].filter(Boolean).join(" "),
    );
    const nextLookup = {
      name: lookupName,
      setName: card.setName,
      number: card.number ?? "",
      grade,
    };

    clearCompEvidence();
    setQuickIntake(cardIdentitySearchText({ name: lookupName, setName: card.setName, number: card.number }, grade, conditionSearchTerm));
    setName(lookupName);
    setSetNameValue(card.setName);
    pinRecentSetName(card.setName);
    setNumber(card.number ?? "");
    setCardArtUrl(card.imageUrl ?? null);
    setManualCompQuery(manualSearch);
    setError(null);
    setNotice(`Rechecking ${lookupName}...`);
    void lookupComp(nextLookup);
  }

  function removeRecentCompEntry(entry: RecentCompEntry) {
    setRecentComps((current) => {
      const next = removeRecentComp(current, entry);
      try {
        window.localStorage.setItem(RECENT_COMPS_STORAGE_KEY, serializeRecentComps(next));
      } catch {
        // Device storage is optional; current state still updates.
      }
      return next;
    });
    setNotice(`${entry.name} removed from recent comps.`);
    setError(null);
  }

  function clearRecentComps() {
    setRecentComps([]);
    try {
      window.localStorage.removeItem(RECENT_COMPS_STORAGE_KEY);
    } catch {
      // Nothing else to do if storage is unavailable.
    }
    setNotice("Recent comps cleared.");
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
    editCompIdentity();
    setSetNameValue(set.name);
    setSetSuggestionsOpen(false);
    pinRecentSet(set.id);
  }

  function chooseCard(card: CatalogCard) {
    const typedText = quickIntake.trim();
    const parsed = typedText ? parseQuickIntake(typedText) : null;
    const firstEditionRequested =
      textMentionsFirstEdition(typedText) ||
      textMentionsFirstEdition(name) ||
      textMentionsFirstEdition(setNameValue) ||
      textMentionsFirstEdition(number);
    const lookupName =
      firstEditionRequested && !textMentionsFirstEdition(card.name)
        ? `${card.name} 1st Edition`
        : card.name;
    const nextGrade = parsed?.grade ?? grade;
    const conditionSearchTerm = parsed?.condition && parsed.condition.toUpperCase() !== "NM" ? parsed.condition : undefined;
    const manualSearch = normalizeManualCompSearchText(typedText);

    clearCompEvidence();
    setQuickIntake(cardIdentitySearchText({ name: lookupName, setName: card.setName, number: card.number }, nextGrade, conditionSearchTerm));
    setName(lookupName);
    setSetNameValue(card.setName);
    pinRecentSetName(card.setName);
    setNumber(card.number ?? "");
    if (parsed?.grade) setGrade(parsed.grade);
    if (parsed?.condition) setCondition(parsed.condition);
    if (parsed?.cost) setCost(parsed.cost);
    if (parsed?.quantity) setQuantity(parsed.quantity);
    if (parsed?.source) setSource(parsed.source);
    if (parsed?.location) setLocation(parsed.location);
    if (parsed?.channel) setChannel(parsed.channel as Channel);
    if (parsed?.listingState) {
      setAcquireListingState(parsed.listingState);
      setShouldCreateListing(true);
    }
    if (card.imageUrl) setCardArtUrl(card.imageUrl);
    setCardSuggestionsOpen(false);
    setManualCompQuery(manualSearch);
    setError(null);
  }

  function handleCardNameChange(value: string) {
    editCompIdentity();
    setName(value);
  }

  function applyTypedCardIdentity() {
    const parsed = normalizeCatalogCardSearchInput(name, setNameValue);
    const shouldApplyParsedFields = Boolean(
      parsed.name &&
        parsed.name !== name.trim() &&
        (parsed.setName || parsed.number),
    );

    if (!shouldApplyParsedFields) return;

    setName(parsed.name);
    if (parsed.setName) {
      setSetNameValue(parsed.setName);
      pinRecentSetName(parsed.setName);
    }
    if (parsed.number) setNumber(parsed.number);
  }

  function loadRecentBuy(item: InventoryItem, options: { lookupAfter?: boolean; repeatBuy?: boolean } = {}) {
    const nextGrade = item.grade as Grade;
    const nextCondition = item.condition ?? (nextGrade === "RAW" ? "NM" : "");
    const existingListing = listingForInventoryItem(item);
    const repeatListPrice = existingListing?.listPrice ?? existingListing?.suggestedPrice ?? null;
    const nextLookup = {
      name: item.card.name,
      setName: item.card.setName,
      number: item.card.number ?? "",
      grade: nextGrade,
    };

    setView("acquire");
    clearCompEvidence();
    setQuickIntake(cardIdentitySearchText({ name: item.card.name, setName: item.card.setName, number: item.card.number }, nextGrade));
    setName(item.card.name);
    setSetNameValue(item.card.setName);
    setNumber(item.card.number ?? "");
    setGrade(nextGrade);
    setCost(options.repeatBuy ? penceToPounds(item.costBasis) : "");
    setQuantity("1");
    setSource(item.acquiredFrom ?? source);
    setLocation(item.location ?? location);
    setCondition(nextCondition);
    if (existingListing?.channel) setChannel(existingListing.channel);
    if (existingListing?.state === "ACTIVE" || existingListing?.state === "DRAFT") {
      setAcquireListingState(existingListing.state);
    }
    setGraderCert(item.graderCert ?? "");
    setPsaResult(null);
    setQuickIntake("");
    setCardArtUrl(item.card.imageUrl);
    setListPriceOverride(options.repeatBuy && repeatListPrice ? penceToPounds(repeatListPrice) : "");
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
    setError(null);

    if (options.lookupAfter) {
      setNotice(`Looking up ${item.card.name}...`);
      void lookupComp(nextLookup);
      return;
    }

    setNotice(options.repeatBuy ? `${item.card.name} loaded with the last buy details.` : `${item.card.name} loaded for another buy.`);
  }

  function compInventoryItem(item: InventoryItem) {
    loadRecentBuy(item, { lookupAfter: true });
    setStockCompItemId(item.id);
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
    setSellingListingId(saleListing?.id ?? null);
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
      currentGross > 0 ? saleItemSubtotalPence(saleChannel, currentGross, { grade: sellingItem?.grade }) : 0;
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
      const itemSubtotal = saleItemSubtotalPence(saleChannel, currentTotal, { grade: sellingItem.grade });
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

  async function pasteSaleTotalPrice() {
    let clipboardText = "";
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      setError("Clipboard read failed. Copy the buyer total, then tap Paste total.");
      return;
    }

    const pricePence = parseCheckedCompPriceText(clipboardText);
    if (!pricePence) {
      setError("Clipboard does not contain a clear buyer total.");
      return;
    }

    applySaleTotalPrice(pricePence);
    setNotice("Buyer total pasted. Fees and your postage cost have been estimated.");
    setError(null);
  }

  async function pasteSaleNetPrice() {
    let clipboardText = "";
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      setError("Clipboard read failed. Copy the payout, then tap Paste net.");
      return;
    }

    const netPence = parseCheckedCompPriceText(clipboardText);
    if (!netPence) {
      setError("Clipboard does not contain a clear payout.");
      return;
    }

    applySaleTotalPrice(grossSalePriceForNetPence(saleChannel, netPence, { grade: sellingItem?.grade }));
    setNotice("Net payout pasted. Buyer total, fees and your postage cost have been estimated.");
    setError(null);
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
    applySaleItemSubtotal(
      acceptedOfferItemSubtotalPence(saleUnitReferencePence(), multiplier, saleQuantityForShortcuts()),
    );
  }

  function applySalePriceDiscount(discountPence: number) {
    if (!sellingItem) return;
    applySaleItemSubtotal(
      discountedItemSubtotalPence(saleUnitReferencePence(), discountPence, saleQuantityForShortcuts()),
    );
  }

  function useBreakEvenSalePrice() {
    if (!sellingItem) return;
    applySaleTotalPrice(
      breakEvenSalePricePence(saleChannel, sellingItem.costBasis * saleQuantityForShortcuts(), {
        grade: sellingItem.grade,
      }),
    );
  }

  function applySaleTargetProfit(targetProfitPence: number) {
    if (!sellingItem) return;
    applySaleTotalPrice(
      grossSalePriceForProfitPence(
        saleChannel,
        sellingItem.costBasis * saleQuantityForShortcuts(),
        targetProfitPence,
        { grade: sellingItem.grade },
      ),
    );
  }

  function applySaleTargetRoi(roiPct: number) {
    if (!sellingItem) return;
    const costPence = sellingItem.costBasis * saleQuantityForShortcuts();
    applySaleTotalPrice(
      grossSalePriceForProfitPence(saleChannel, costPence, Math.round(costPence * roiPct), {
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

  function changeSaleQuantity(value: string) {
    const nextQuantity = parseIntakeQuantity(value);
    const currentQuantity = saleQuantityForShortcuts();
    setSaleQuantity(value);
    if (!sellingItem || !nextQuantity || nextQuantity > sellingItem.quantity) return;
    const nextGross = rescaleGrossSaleForQuantity(
      saleChannel,
      poundsToPence(salePrice),
      currentQuantity,
      nextQuantity,
      { grade: sellingItem.grade },
    );
    applySaleTotalPrice(nextGross);
  }

  function applyCashSale() {
    const currentGross = poundsToPence(salePrice);
    const itemSubtotal =
      currentGross > 0 ? saleItemSubtotalPence(saleChannel, currentGross, { grade: sellingItem?.grade }) : currentGross;
    setSaleChannel("IN_PERSON");
    setSalePrice(penceToPounds(itemSubtotal));
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
    setSellingListingId(null);
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
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const continueSelling = submitter?.value === "next";
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
    const nextSaleListing = continueSelling ? nextSaleAfterCurrentTarget : null;
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
          listingId: sellingListingId ?? undefined,
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "mark sold failed");
      const saleNotice = `${soldQuantity > 1 ? `${soldQuantity} copies sold` : "Sold"}. Profit ${gbp(payload.profitPence)}.`;
      setSellingId(null);
      setSellingListingId(null);
      await refreshAll();
      if (nextSaleListing?.item) {
        setNotice(`${saleNotice} Next sale loaded.`);
        setListingStateFilter("ACTIVE");
        setListingSort("newest");
        setView("listings");
        openSell(nextSaleListing.item, nextSaleListing);
      } else {
        setNotice(saleNotice);
        setView("pnl");
      }
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
    setSellingListingId(null);
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
    // EBAY listings can only start ACTIVE if a genuine live URL is supplied —
    // otherwise they must go through Create offer -> Publish. Other channels
    // (Cardmarket/Vinted/in-person) are manually tracked, so direct activate
    // is fine.
    const trimmedExternalUrl = listingExternalUrl.trim();
    const canActivateDirect =
      listingState === "ACTIVE" && (listingChannel !== "EBAY" || Boolean(trimmedExternalUrl));
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          channel: listingChannel,
          state: canActivateDirect ? "ACTIVE" : "DRAFT",
          listPricePence: poundsToPence(listingPrice),
          externalUrl: trimmedExternalUrl || null,
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "listing create failed");
      const listing = payload.listing as Listing;
      setCreatingListingItemId(null);
      setView("listings");
      setListingStateFilter(canActivateDirect ? "ACTIVE" : "DRAFT");
      openListingPack(listing);
      setNotice(
        canActivateDirect
          ? `${item.card.name} listing activated. Listing pack is ready.`
          : listingState === "ACTIVE" && listingChannel === "EBAY"
            ? `${item.card.name} listing drafted. Create the eBay offer and publish it to go live.`
            : `${item.card.name} listing drafted. Listing pack is ready.`,
      );
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "listing create failed");
    } finally {
      setBusy(null);
    }
  }

  async function quickDraftListingForItem(item: InventoryItem): Promise<Listing | null> {
    const defaults = buildListingDraftDefaults({
      card: item.card,
      grade: item.grade,
      costBasis: item.costBasis,
    });

    setBusy(`create-listing-${item.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          channel: "EBAY",
          state: "DRAFT",
          listPricePence: defaults.listPricePence,
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "listing create failed");
      const listing = payload.listing as Listing;
      setNotice(`${item.card.name} draft created. Listing pack is ready.`);
      setCreatingListingItemId(null);
      setListingStateFilter("DRAFT");
      setView("listings");
      openListingPack(listing);
      await refreshAll();
      return listing;
    } catch (err) {
      setError(err instanceof Error ? err.message : "listing create failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function listInventoryItem(item: InventoryItem) {
    const listing = item.listings.find((row) => row.state !== "SOLD" && row.state !== "ENDED") ?? item.listings[0];
    if (!listing) {
      await quickDraftListingForItem(item);
      return;
    }
    const isUnpublishedEbay =
      listing.channel === "EBAY" &&
      !(listing.externalRef && !listing.externalRef.startsWith("offer:") && listing.externalUrl);
    if (isUnpublishedEbay) {
      // eBay listings can't be activated directly — route to the listing
      // pack so the real Create offer -> Publish flow runs.
      setView("listings");
      setListingStateFilter(listing.state === "DRAFT" ? "DRAFT" : "ALL");
      openListingPack(listing);
      setNotice("Create the eBay offer and publish it to make this listing live.");
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
      setListingStateFilter("DRAFT");
      void quickDraftListingForItem(item);
      return;
    }
    setListingStateFilter(listing.state === "ACTIVE" || listing.state === "DRAFT" ? listing.state : "ALL");
    openListingPack(listing);
  }

  function sellRecentBuy(item: InventoryItem) {
    setView("inventory");
    openSell(item, listingForInventoryItem(item) ?? undefined);
  }

  function openLastStockedPack() {
    if (!lastStocked?.listingId) {
      setView("listings");
      setListingStateFilter("DRAFT");
      setNotice("Open Listings to create a pack for that stock row.");
      return;
    }
    const listing = listings.find((row) => row.id === lastStocked.listingId);
    setView("listings");
    setListingStateFilter(lastStocked.listingState === "ACTIVE" ? "ACTIVE" : "DRAFT");
    if (!listing) {
      setNotice("Listing saved. Open it from the listing queue.");
      return;
    }
    openListingPack(listing);
  }

  function sellLastStocked() {
    if (!lastStocked) return;
    const item = inventory.find((row) => row.id === lastStocked.itemId);
    const listing = lastStocked.listingId ? listings.find((row) => row.id === lastStocked.listingId) : null;
    setView("inventory");
    if (!item) {
      setNotice("Stock saved. Open it from Stock to record a sale.");
      return;
    }
    openSell(item, listing ?? listingForInventoryItem(item) ?? undefined);
  }

  function compNextFromLastStocked() {
    clearCurrentComp("Ready for the next comp.");
    setLastStocked(null);
    setView("acquire");
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
    setEbayPreflight(null);
    setEditingListingId(null);
    setCreatingListingItemId(null);
    setSellingId(null);
    setSellingListingId(null);
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

  async function copyListingPackAndOpenVenue() {
    if (!listingPack || !listingPackTarget) return;
    const venueAction = listingVenueAction(listingPackTarget.channel, { query: listingPackSearchQuery(listingPackTarget, listingPack) });
    if (venueAction) window.open(venueAction.url, "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(listingPack.copyReady);
      setListingPackCopied(true);
      setListingPackCopiedField(null);
      setNotice(
        venueAction
          ? `Listing pack copied. ${venueAction.openedLabel} opened.`
          : "Listing pack copied.",
      );
      setError(null);
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
    setEbayPreflight(null);
    setError(null);
    setNotice(null);
  }

  function openListingDesk() {
    if (firstDraftListingTarget || unlistedStock.length > 0) {
      startListingDesk();
      return;
    }
    setListingStateFilter("ALL");
    setListingSort("newest");
    setView("listings");
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
    void quickDraftListingForItem(item);
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
    setEbayPreflight(null);
  }

  async function pasteListingUrlForListing(listing: Listing) {
    let clipboardText = "";
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      setError("Clipboard read failed. Use Edit to paste the listing URL manually.");
      return;
    }

    const externalUrl = normalizeListingUrl(clipboardText);
    if (!externalUrl) {
      setError("Clipboard does not contain a valid listing URL.");
      return;
    }

    const ok = await patchListing(
      listing,
      { state: "ACTIVE", externalUrl },
      "Live URL saved. Listing marked active.",
    );
    if (!ok) return;
    setListingPackCopied(false);
    setListingPackCopiedField(null);
    setEbayPreflight(null);
  }

  async function pasteListingUrlAndActivate() {
    if (!listingPackTarget) return;
    await pasteListingUrlForListing(listingPackTarget);
  }

  async function runEbayPreflight(listingId: string) {
    setBusy(`ebay-preflight-${listingId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/ebay/preflight`);
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "eBay preflight failed");
      setEbayPreflight({ ...payload, listingId });
      setNotice("eBay preflight passed. No offer was created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "eBay preflight failed");
    } finally {
      setBusy(null);
    }
  }

  async function createEbayOfferForListing(listingId: string) {
    setBusy(`ebay-offer-${listingId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/ebay/offer`, { method: "POST" });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "eBay offer creation failed");
      setEbayPreflight(null);
      setNotice(payload.message ?? "eBay offer created.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "eBay offer creation failed");
    } finally {
      setBusy(null);
    }
  }

  async function createEbaySellerLocation(event?: FormEvent) {
    event?.preventDefault();
    setBusy("ebay-location");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/ebay/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ebayLocationName,
          addressLine1: ebayLocationAddress1,
          addressLine2: ebayLocationAddress2,
          city: ebayLocationCity,
          postalCode: ebayLocationPostcode,
          country: ebayLocationCountry,
        }),
      });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "eBay seller location setup failed");
      setNotice(payload.message ?? "eBay seller location is ready.");
      const statusRes = await fetch("/api/ebay/status");
      const statusPayload = await readJson(statusRes);
      if (statusRes.ok) setEbayStatus(statusPayload);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "eBay seller location setup failed");
    } finally {
      setBusy(null);
    }
  }

  async function publishEbayListing(listingId: string) {
    setEbayPublishTarget(null);
    setBusy(`ebay-publish-${listingId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/ebay/publish`, { method: "POST" });
      const payload = await readJson(res);
      if (!res.ok) throw new Error(payload.error ?? "eBay publish failed");
      setNotice(payload.message ?? "Published on eBay.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "eBay publish failed");
    } finally {
      setBusy(null);
    }
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
      const message =
        count === 0
          ? "No repricing alerts right now."
          : `${count} repricing action${count === 1 ? "" : "s"} found${payload.notified ? " and sent" : ""}.`;
      setRepriceMessage(message);
      setNotice(message);
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

  async function applyStockCompReprice() {
    if (!stockCompItem || !stockCompSuggestion) return;
    if (!stockCompListing) {
      setError("Draft a listing first, then reprice it from the comp.");
      return;
    }
    const ok = await patchListing(
      stockCompListing,
      { listPricePence: stockCompSuggestion.pricePence },
      `Repriced ${stockCompItem.card.name} to ${gbp(stockCompSuggestion.pricePence)}.`,
    );
    if (ok) setStockCompItemId(null);
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
      const message =
        hits.length === 0
          ? "No sourcing targets hit right now."
          : alertsCreated === 0
            ? `${hits.length} sourcing target${hits.length === 1 ? "" : "s"} still hit. No duplicate alert sent.`
            : `${hits.length} sourcing target${hits.length === 1 ? "" : "s"} hit; ${alertsCreated} new alert${alertsCreated === 1 ? "" : "s"}${payload.notified ? " sent" : ""}.`;
      setWatchMessage(message);
      setNotice(message);
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

  function openManualCompLink(kind: ManualCompLinkKind = "EBAY_UK_SOLD") {
    const link = manualCompLinks.find((candidate) => candidate.kind === kind);
    if (!link?.url) return;
    setManualCompQuery(link.query);
    setManualCompReturnArmed(true);
    if (kind === "EBAY_UK_SOLD") setCheckedCompSource("EBAY_SOLD");
    window.open(link.url, "_blank", "noopener,noreferrer");
    setNotice(kind === "EBAY_UK_SOLD" ? "Opened eBay UK solds. Paste or enter the sold price when you are back." : "Opened manual comp source.");
    setError(null);
  }

  function applyQuickCost(valuePence: number) {
    setCost(penceToPounds(valuePence));
    setError(null);
  }

  function applyTotalCostSplit() {
    if (!totalCostSplit) return;
    setCost(penceToPounds(totalCostSplit.unitCostPence));
    setNotice(
      `Split total into ${gbp(totalCostSplit.unitCostPence)} each${
        totalCostSplit.roundingDeltaPence
          ? ` (${totalCostSplit.roundingDeltaPence > 0 ? "+" : ""}${gbp(totalCostSplit.roundingDeltaPence)} rounding)`
          : ""
      }.`,
    );
    setError(null);
  }

  function applyCheckedCompPrice(valuePence: number) {
    setCheckedCompPrice(penceToPounds(valuePence));
    setCheckedCompSample((current) => (Number(current) > 0 ? current : "1"));
    setManualCompReturnArmed(false);
    setNotice("Checked comp price filled. Adjust it if the sold listing differs.");
    setError(null);
  }

  async function pasteCheckedCompPrice() {
    let clipboardText = "";
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      setError("Clipboard read failed. Copy the sold price, then tap Paste price.");
      return;
    }

    const pricePence = parseCheckedCompPriceText(clipboardText);
    if (!pricePence) {
      setError("Clipboard does not contain a clear sold price.");
      return;
    }

    applyCheckedCompPrice(pricePence);
  }

  function jumpToCheckedComp() {
    checkedCompRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function jumpToCostEntry() {
    costInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.requestAnimationFrame(() => costInputRef.current?.focus());
  }

  function runStockAction() {
    if (!quickStockReady) {
      jumpToCostEntry();
      return;
    }
    if (requiresCheckedCompBeforeStock) {
      jumpToCheckedComp();
      return;
    }
    void acquire();
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
            onKeyDown={(event) => {
              if (event.key === "Enter" && ebayQuery.trim()) {
                event.preventDefault();
                openManualCompLink("EBAY_UK_SOLD");
              }
            }}
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
          <button type="button" onClick={() => openManualCompLink("EBAY_UK_SOLD")} disabled={!ebayQuery.trim()}>
            Open UK
          </button>
          <button type="button" onClick={() => void copyManualCompQuery()} disabled={!ebayQuery.trim()}>
            Copy
          </button>
        </div>
        {ebayQuery && <div className="manual-comp-query">{ebayQuery}</div>}
        {ebayQuery
          ? manualCompLinks.map((link) => (
              <a key={link.kind} className={link.primary ? "primary-link" : ""} href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))
          : null}
      </div>
    );
  }

  function renderCheckedCompCard(variant: "full" | "priority" = "full") {
    const canOpenUkSolds = manualCompLinks.some((link) => link.kind === "EBAY_UK_SOLD" && link.query.trim());
    const awaitingManualPrice = manualCompReturnArmed && !checkedComp;

    return (
      <div
        className={`checked-comp-card ${checkedComp ? "active" : ""} ${awaitingManualPrice ? "awaiting" : ""} ${variant}`}
        ref={variant === "priority" ? checkedCompRef : undefined}
      >
        <div className="checked-comp-heading">
          <div>
            <span>Checked comp</span>
            <strong>{checkedComp ? `${gbp(checkedComp.medianPence)} in use` : awaitingManualPrice ? "Paste or enter sold price" : "Optional override"}</strong>
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
        <div className="checked-comp-quick-actions">
          <button type="button" onClick={() => void pasteCheckedCompPrice()}>
            Paste price
          </button>
          <button type="button" onClick={() => openManualCompLink("EBAY_UK_SOLD")} disabled={!canOpenUkSolds}>
            Open UK solds
          </button>
        </div>
        {awaitingManualPrice && (
          <div className="checked-comp-return">
            <strong>Back from solds?</strong>
            <span>Copy a sold price then tap Paste price, or type it above.</span>
          </div>
        )}
        {checkedCompPriceOptions.length > 0 && (
          <div className="checked-comp-price-presets" aria-label="Checked comp price shortcuts">
            {checkedCompPriceOptions.map((option) => (
              <button key={`${option.label}-${option.valuePence}`} type="button" onClick={() => applyCheckedCompPrice(option.valuePence)}>
                {option.label} {gbp(option.valuePence)}
              </button>
            ))}
          </div>
        )}
        <div className="checked-comp-presets" role="group" aria-label="Checked comp source">
          {checkedCompSources.map((source) => (
            <button
              key={source}
              type="button"
              className={source === checkedCompSource ? "selected" : ""}
              onClick={() => setCheckedCompSource(source)}
            >
              {checkedCompSourceLabel(source)}
            </button>
          ))}
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
        <div className="checked-comp-presets" role="group" aria-label="Checked comp sample size">
          {checkedCompSampleOptions.map((sample) => (
            <button
              key={sample}
              type="button"
              className={String(Math.max(1, Math.round(Number(checkedCompSample)))) === sample ? "selected" : ""}
              onClick={() => setCheckedCompSample(sample)}
            >
              {sample} sold{sample === "1" ? "" : "s"}
            </button>
          ))}
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

  function renderQuickStockCard() {
    return (
      <div className={`quick-stock-card ${buyPlan?.tone ?? "warn"}`}>
        <div className="quick-stock-heading">
          <div>
            <span>Ready to stock</span>
            <strong>
              {requiresCheckedCompBeforeStock
                ? "Add checked comp"
                : quickStockReady
                  ? shouldCreateListing
                    ? `${quickStockQuantity} + ${acquireListingState === "ACTIVE" ? "active listing" : "draft"}`
                    : `${quickStockQuantity} to stock`
                  : "Add cost"}
            </strong>
          </div>
          <span className={`pill ${quickStockCostPence > 0 ? buyPlan?.tone ?? "warn" : "warn"}`}>
            {quickStockCostPence > 0 ? buyPlan?.label ?? "Check" : "Add cost"}
          </span>
        </div>
        <div className="quick-stock-grid">
          <label>
            Cost
            <MoneyInput ref={costInputRef} value={cost} onChange={setCost} />
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
            value={quickStockCostPence > 0 && buyPlan ? gbp(buyPlan.totalProfitPence) : "n/a"}
            tone={quickStockCostPence > 0 && buyPlan && buyPlan.totalProfitPence >= 0 ? "good" : "warn"}
          />
        </div>
        <details className="buy-advanced-details optional-listing-details">
          <summary>Optional listing after stock</summary>
          <div className="form-grid">
            <label>
              List price
              <MoneyInput value={listPriceOverride} onChange={setListPriceOverride} placeholder="auto" />
            </label>
            <label>
              Channel
              <select value={channel} onChange={(event) => setChannel(event.target.value as Channel)}>
                {channels.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
              </select>
            </label>
          </div>
          <div className="listing-choice" role="group" aria-label="After stock listing choice">
            <button type="button" className={!shouldCreateListing ? "selected" : ""} onClick={() => setShouldCreateListing(false)}>
              List later
            </button>
            <button
              type="button"
              className={shouldCreateListing && acquireListingState === "DRAFT" ? "selected" : ""}
              onClick={() => {
                setShouldCreateListing(true);
                setAcquireListingState("DRAFT");
              }}
            >
              Draft
            </button>
            <button
              type="button"
              className={shouldCreateListing && acquireListingState === "ACTIVE" ? "selected" : ""}
              onClick={() => {
                setShouldCreateListing(true);
                setAcquireListingState("ACTIVE");
              }}
            >
              Active
            </button>
          </div>
        </details>
        {totalCostSplit && (
          <div className="split-cost-card">
            <div>
              <span>Total paid</span>
              <strong>
                {gbp(quickStockCostPence)} / {quickStockQuantity}
              </strong>
              <small>
                Ledger cost {gbp(totalCostSplit.unitCostPence)} each
                {totalCostSplit.roundingDeltaPence
                  ? ` · ${totalCostSplit.roundingDeltaPence > 0 ? "+" : ""}${gbp(totalCostSplit.roundingDeltaPence)} rounding`
                  : ""}
              </small>
            </div>
            <button type="button" onClick={applyTotalCostSplit}>
              Split total
            </button>
          </div>
        )}
        {quickOfferOptions.length > 0 && (
          <div className="quick-offer-presets" aria-label="Quick cost presets">
            {quickOfferOptions.map((option) => (
              <button key={`${option.label}-${option.valuePence}`} type="button" onClick={() => applyQuickCost(option.valuePence)}>
                {option.label} {gbp(option.valuePence)}
              </button>
            ))}
          </div>
        )}
        {buyPlan && quickStockCostPence > 0 && (
          <div className={`buy-plan compact ${buyPlan.tone}`} aria-label="Buy decision">
            <div className="buy-plan-heading">
              <span>Verdict</span>
              <strong>{buyPlan.label}</strong>
              <small>{buyPlan.note}</small>
            </div>
            <div>
              <span>Expected sale</span>
              <strong>{gbp(buyPlan.unitGrossSalePence)}</strong>
              <small>net {gbp(buyPlan.unitNetPence)}</small>
            </div>
            <div>
              <span>Costs</span>
              <strong>{gbp(buyPlan.unitFeesPence + buyPlan.unitPostagePence)}</strong>
              <small>
                fees {gbp(buyPlan.unitFeesPence)} · post {gbp(buyPlan.unitPostagePence)}
              </small>
            </div>
            <div>
              <span>Return</span>
              <strong>{formatPct(buyPlan.roiPct)}</strong>
              <small>{formatPct(buyPlan.marginPct)} margin</small>
            </div>
          </div>
        )}
        <button
          className="primary-action"
          type="button"
          onClick={runStockAction}
          disabled={busy === "acquire" || (quickStockReady && !quickStockCanSubmit)}
        >
          {busy === "acquire"
            ? "Stocking..."
            : !quickStockReady
              ? "Add cost"
              : requiresCheckedCompBeforeStock
                ? "Add checked comp first"
                : shouldCreateListing
                  ? `${stockButtonLabel} + listing`
                  : stockButtonLabel}
        </button>
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
        <div className="topbar-actions">
          <button className={view === "today" ? "topbar-secondary active" : "topbar-secondary"} type="button" onClick={() => setView("today")}>
            Status
          </button>
          <button className="topbar-secondary" type="button" onClick={openBuyWatchesPanel}>
            Watch
          </button>
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
        </div>
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
                <span className="muted">{launchProgress.label} · {launchProgress.nextLabel}</span>
              </div>
              <button className="ghost-button" type="button" onClick={() => setView("acquire")}>
                New buy
              </button>
            </div>
            {primaryTodayAction && (
              <NextMoveCard action={primaryTodayAction} progress={launchProgress} onOpen={openTodayAction} />
            )}
            <div className="today-action-list">
              {todayActions.map((action) => (
                <TodayActionButton key={action.id} action={action} onOpen={openTodayAction} />
              ))}
            </div>
          </section>

          <section className="panel operating-snapshot-panel">
            <div className="panel-heading">
              <div>
                <h2>Operating snapshot</h2>
                <span className="muted">cash, stock and listing flow</span>
              </div>
              <button className="ghost-button" type="button" onClick={() => setView("pnl")}>
                Profit
              </button>
            </div>
            <div className="operating-snapshot-grid">
              {operatingSnapshot.map((row) => (
                <OperatingSnapshotCard key={row.id} row={row} />
              ))}
            </div>
          </section>

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
                    setView("listings");
                  }}
                >
                  Active
                </button>
              </div>
              <div className="listing-desk-card">
                <CardImage
                  src={firstSaleListingTarget.item.card.imageUrl}
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

          <section className="panel launch-plan-panel">
            <div className="panel-heading">
              <div>
                <h2>First week</h2>
                <span className="muted">{launchProgress.label}</span>
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
              {setupSources.map((source) => (
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
                action={(dashboard?.metrics.stockCount ?? 0) > 0 ? "Buy" : "Import"}
                onClick={() => {
                  if ((dashboard?.metrics.stockCount ?? 0) > 0) {
                    setView("acquire");
                    return;
                  }
                  openOpeningStockImport({ example: true });
                }}
              />
              <SetupStep
                done={listings.length > 0}
                title="Listing pipeline"
                detail={`${draftListingCount} draft / ${activeListingCount} active`}
                action="Listings"
                onClick={openListingDesk}
              />
              <SetupStep
                done={(dashboard?.metrics.soldCount ?? 0) > 0}
                title="Booked sales"
                detail={`${dashboard?.metrics.soldCount ?? 0} sold`}
                action={activeListingCount > 0 ? "Sell" : "Stock"}
                onClick={activeListingCount > 0 ? openSalesDesk : () => setView("inventory")}
              />
              <SetupStep
                done={activeWatchCount > 0}
                title="Sourcing targets"
                detail={`${activeWatchCount} active`}
                action="Targets"
                onClick={openBuyWatchesPanel}
              />
              <SetupStep
                done={(dashboard?.metrics.operatingExpensePence ?? 0) > 0}
                title="Cost tracker"
                detail={gbp(dashboard?.metrics.operatingExpensePence ?? 0)}
                action="Costs"
                onClick={openCostsPanel}
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
              <button type="button" onClick={() => openOpeningStockImport()}>Import stock</button>
              <button type="button" onClick={activeListingCount > 0 ? openSalesDesk : () => setView("inventory")}>Sell stock</button>
              <button type="button" onClick={openListingDesk}>List drafts</button>
              <button type="button" onClick={takePortfolioSnapshot} disabled={busy === "snapshot"}>
                {busy === "snapshot" ? "Snapshot..." : "Snapshot"}
              </button>
              <button type="button" onClick={() => {
                openBuyWatchesPanel();
                void checkWatches();
              }} disabled={busy === "watch-check"}>
                {busy === "watch-check" ? "Checking..." : "Targets"}
              </button>
              <button type="button" onClick={checkReprices} disabled={busy === "reprice"}>
                {busy === "reprice" ? "Checking..." : "Reprice"}
              </button>
              <button type="button" onClick={() => setView("pnl")}>Profit</button>
              <button type="button" onClick={openCostsPanel}>Add cost</button>
              <a className="export-link" href="/api/export/books" download>Books CSV</a>
              <a className="export-link" href="/api/export/listings?state=DRAFT" download>Draft CSV</a>
              <a className="export-link" href="/api/export/listing-pack" download>Listing pack</a>
            </div>
          </section>
        </section>
      )}

      {view === "acquire" && (
        <section className="workspace buy-workspace">
          <form className="panel lookup-panel" onSubmit={lookup}>
            <div className="panel-heading">
              <h2>Comp, buy, stock</h2>
              <span className="muted">type what is on the card</span>
            </div>
            <div className="quick-intake-field">
              <label htmlFor="quick-intake">Smart comp search</label>
              <div className={`quick-intake-row quick-intake-actions ${canClearCurrentComp ? "has-next" : ""}`}>
                <input
                  id="quick-intake"
                  ref={quickIntakeRef}
                  value={quickIntake}
                  onChange={(event) => {
                    setQuickIntake(event.target.value);
                    setCardSuggestions([]);
                    setCardSuggestionsLoading(Boolean(event.target.value.trim()));
                    if (comp || checkedCompPrice.trim()) clearCompEvidence();
                  }}
                  onFocus={() => setCardSuggestionsOpen(true)}
                  onBlur={() => setTimeout(() => setCardSuggestionsOpen(false), 150)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && quickIntake.trim()) {
                      event.preventDefault();
                      applyQuickIntake({ lookupAfter: true });
                    }
                  }}
                  placeholder="Umbreon prismatic, Victini promo, Lugia Neo Genesis CGC 1.5..."
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={runSmartComp}
                  disabled={!canRunSmartComp || busy === "lookup"}
                  aria-label="Comp current card"
                >
                  {busy === "lookup" ? "..." : "Comp"}
                </button>
                {canClearCurrentComp && (
                  <button
                    className="quick-next-button"
                    type="button"
                    onClick={() => clearCurrentComp()}
                    disabled={busy === "lookup" || busy === "acquire" || busy === "manual-stock"}
                    aria-label="Clear and comp another card"
                  >
                    Next
                  </button>
                )}
              </div>
              {cardSuggestionsOpen && quickIntake.trim() && (cardSuggestions.length > 0 || typedFallbackSuggestion) && (
                <div className="smart-card-suggestions" role="listbox" aria-label="Card suggestions">
                  {cardSuggestions.map((card) => (
                    <button
                      key={card.tcgApiId ?? card.tcgDexId ?? `${card.name}-${card.setName}-${card.number ?? ""}`}
                      type="button"
                      className="suggestion-item card-option"
                      onClick={() => chooseCard(card)}
                    >
                      <CardImage src={card.imageUrl ?? null} className="suggestion-card-art" fallbackClassName="suggestion-card-art blank" alt="" />
                      <span>{card.name}</span>
                      <small>{catalogSuggestionMeta(card)}</small>
                    </button>
                  ))}
                  {typedFallbackSuggestion && (
                    <button
                      type="button"
                      className="suggestion-item card-option typed-fallback-option"
                      onClick={() => {
                        applyQuickIntake();
                        setCardSuggestionsOpen(false);
                      }}
                    >
                      <span className="suggestion-card-art blank" aria-hidden="true" />
                      <span>{typedFallbackSuggestion.name}</span>
                      <small>
                        {typedFallbackSuggestion.setName || "Manual card"}
                        {typedFallbackSuggestion.number ? ` #${typedFallbackSuggestion.number}` : " · manual identity"} ·{" "}
                        {typedFallbackSuggestion.grade.replace(/_/g, " ")}
                      </small>
                    </button>
                  )}
                </div>
              )}
            </div>
            {quickIntakePreview && (
              <div className={`quick-intake-preview ${quickIntakePreview.tone}`} aria-label="Quick fill preview">
                <div className="quick-intake-preview-heading">
                  <span>Heard</span>
                  <strong>{quickIntakePreview.summary}</strong>
                </div>
                <div className="quick-intake-preview-chips">
                  {quickIntakePreview.chips.map((chip) => (
                    <span className={chip.source === "current" ? "current" : ""} key={`${chip.key}-${chip.value}`}>
                      <b>{chip.label}</b>
                      {chip.value}
                    </span>
                  ))}
                </div>
                {(quickIntakePreview.missing.length > 0 || quickIntakePreview.warnings.length > 0) && (
                  <p>
                    {[...quickIntakePreview.missing.map((item) => `Needs ${item}`), ...quickIntakePreview.warnings].join(" · ")}
                  </p>
                )}
              </div>
            )}
            <div className="selected-card-strip" aria-label="Selected card">
              <CardImage
                src={selectedCardImage}
                className="selected-card-art"
                fallbackClassName="selected-card-art blank"
                alt={`${selectedCardTitle} card art`}
              />
              <div>
                <span>Current card</span>
                <strong>{selectedCardTitle}</strong>
                <small>{selectedCardMeta}</small>
              </div>
              <div className="selected-card-actions">
                {selectedCardMarkUrl && (
                  <img
                    className="selected-set-mark"
                    src={selectedCardMarkUrl}
                    alt={`${selectedSet?.name ?? catalogCard?.setName ?? setNameValue} set logo`}
                    onError={hideBrokenImage}
                  />
                )}
                <button
                  className="clear-comp-button"
                  type="button"
                  onClick={() => clearCurrentComp()}
                  aria-label="Clear and comp another card"
                  title="Clear and comp another card"
                  disabled={busy === "lookup" || busy === "acquire" || busy === "manual-stock"}
                >
                  X
                </button>
              </div>
            </div>
            {recentComps.length > 0 && (
              <details className="buy-optional-drawer recent-comp-drawer">
                <summary>
                  <span>Recent comps</span>
                  <small>{recentComps.length} saved</small>
                </summary>
                <div className="recent-comp-strip" aria-label="Recent comps">
                  <div className="recent-comp-heading">
                    <span>Tap to recheck live</span>
                    <button className="ghost-button" type="button" onClick={clearRecentComps}>
                      Clear
                    </button>
                  </div>
                  <div className="recent-comp-row">
                    {recentComps.map((entry) => (
                      <article className={`recent-comp-card ${entry.confidenceTone}`} key={recentCompKey(entry)}>
                        <button
                          className="recent-comp-pick"
                          type="button"
                          onClick={() => chooseRecentComp(entry, { lookupAfter: true })}
                          disabled={busy === "lookup"}
                        >
                          <CardImage
                            src={entry.imageUrl}
                            className="recent-comp-art"
                            fallbackClassName="recent-comp-art blank"
                            alt=""
                          />
                          <span className="recent-comp-copy">
                            <strong>{entry.name}</strong>
                            <small>
                              {entry.setName}
                              {entry.number ? ` #${entry.number}` : ""} · {entry.grade.replace(/_/g, " ")}
                            </small>
                            <em>
                              {entry.pricePence > 0 ? `Last ${gbp(entry.pricePence)}` : "No price"} · {entry.confidenceLabel}
                            </em>
                            <small className="recent-comp-meta">{recentCompMeta(entry)}</small>
                          </span>
                        </button>
                        <button
                          className="recent-comp-remove danger-button"
                          type="button"
                          onClick={() => removeRecentCompEntry(entry)}
                          aria-label={`Remove ${entry.name} recent comp`}
                        >
                          x
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              </details>
            )}
            <div className="smart-grade-strip" aria-label="Quick grade">
              {quickGrades.map((g) => (
                <button
                  key={g}
                  className={grade === g ? "selected" : ""}
                  type="button"
                  onClick={() => {
                    clearCompEvidence();
                    setGrade(g);
                  }}
                >
                  {g.replace(/_/g, " ")}
                </button>
              ))}
            </div>
            <details className="buy-advanced-details identity-details">
              <summary>Advanced card, slab and buying details</summary>
            <IntakeSessionCard
              source={source}
              location={location}
              condition={condition}
              channel={channel}
              listingState={acquireListingState}
              keepBuying={keepBuying}
              onSourceChange={setSource}
              onLocationChange={setLocation}
              onConditionChange={setCondition}
              onChannelChange={setChannel}
              onListingStateChange={setAcquireListingState}
              onKeepBuyingChange={setKeepBuying}
            />
            <label className="set-field">
              Card
              <input
                value={name}
                onChange={(event) => {
                  handleCardNameChange(event.target.value);
                }}
                onFocus={() => setCardSuggestionsOpen(true)}
                onBlur={() => {
                  applyTypedCardIdentity();
                  setTimeout(() => setCardSuggestionsOpen(false), 150);
                }}
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
                      <small>{catalogSuggestionMeta(card)}</small>
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
                    editCompIdentity();
                    setSetNameValue(event.target.value);
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
                    editCompIdentity();
                    setNumber(event.target.value);
                  }}
                  placeholder="199/165"
                />
              </label>
            </div>
            <div className="form-grid">
              <label className="grade-select-field">
                Full grade list
                <select
                  value={grade}
                  onChange={(event) => {
                    clearCompEvidence();
                    setGrade(event.target.value as Grade);
                  }}
                >
                  {gradeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
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
            </div>
            {psaResult && <PsaCertCard result={psaResult} />}
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
            </details>
            {!headline && hasBuyContext && renderManualCompLinks("compact")}
            {!headline && hasBuyContext && (
              <details className="panel optional-tool-panel manual-check-panel">
                <summary>
                  <span>Optional</span>
                  <strong>Enter checked price</strong>
                  <small>after eBay solds</small>
                </summary>
                {renderCheckedCompCard("priority")}
              </details>
            )}
            {!headline && (
              <details className="buy-optional-drawer quick-picks-drawer">
                <summary>
                  <span>Quick picks</span>
                  <small>{quickHunts.length} cards</small>
                </summary>
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
              </details>
            )}
          </form>
          <BuyFlowRail steps={buyFlowSteps} />
          {lastStocked && (
            <LastStockedPanel
              card={lastStocked}
              onPack={openLastStockedPack}
              onSell={sellLastStocked}
              onNext={compNextFromLastStocked}
              onDismiss={() => setLastStocked(null)}
            />
          )}

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
                <div className="comp-hero-actions">
                  <span className={`pill ${confidenceLabel?.tone ?? ""}`}>{confidenceLabel?.label}</span>
                  <button
                    className="ghost-button comp-check-button"
                    type="button"
                    onClick={() => openManualCompLink("EBAY_UK_SOLD")}
                  >
                    UK solds
                  </button>
                  <button className="ghost-button comp-skip-button" type="button" onClick={skipCurrentComp}>
                    Next comp
                  </button>
                </div>
              </div>
              <div className="comp-identity-strip" aria-label="Comp card identity">
                <CardImage
                  src={selectedCardImage}
                  className="comp-identity-art"
                  fallbackClassName="comp-identity-art blank"
                  alt={`${selectedCardTitle} card art`}
                />
                <div>
                  <span>{grade.replace(/_/g, " ")}</span>
                  <strong>{selectedCardTitle}</strong>
                  <small>{selectedCardMeta}</small>
                </div>
                {selectedCardMarkUrl && (
                  <img
                    className="comp-identity-set-mark"
                    src={selectedCardMarkUrl}
                    alt={`${selectedSet?.name ?? catalogCard?.setName ?? setNameValue} set logo`}
                    onError={hideBrokenImage}
                  />
                )}
              </div>
              {!needsManualComp && !stockCompItem && renderQuickStockCard()}
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
              {comp?.alternatives && comp.alternatives.length > 0 && (
                <div className="catalog-alternatives" aria-label="Possible catalog matches">
                  <div className="catalog-alternatives-heading">
                    <span>Possible matches</span>
                    <strong>Tap to recheck</strong>
                  </div>
                  <div className="catalog-alternative-row">
                    {comp.alternatives.map((card) => (
                      <button
                        key={card.tcgApiId ?? `${card.name}-${card.setName}-${card.number ?? ""}`}
                        className="catalog-alternative-card"
                        type="button"
                        onClick={() => chooseCatalogAlternative(card)}
                        disabled={busy === "lookup"}
                      >
                        <CardImage
                          src={card.imageUrl ?? null}
                          className="catalog-alternative-art"
                          fallbackClassName="catalog-alternative-art blank"
                          alt=""
                        />
                        <span>
                          <strong>{card.name}</strong>
                          <small>
                            {card.setName}
                            {card.number ? ` #${card.number}` : ""}
                          </small>
                        </span>
                        {(card.setLogoUrl || card.setSymbolUrl) && (
                          <img src={card.setLogoUrl ?? card.setSymbolUrl} alt="" onError={hideBrokenImage} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {shouldOfferManualComp && !needsManualComp && (
                <div className="manual-rescue-card soft">
                  <div>
                    <span>Worth a quick check</span>
                    <strong>
                      {!catalogCard && !dealerVerdict
                        ? "Catalog image missing"
                        : comp?.sourcesDisagree
                          ? "Sources disagree"
                          : "Confidence is cautious"}
                    </strong>
                  </div>
                  <ol>
                    <li>Open eBay UK solds before buying bigger quantities.</li>
                    <li>Use the exact typed wording for promos, editions and condition.</li>
                  </ol>
                </div>
              )}
              {shouldOfferManualComp && renderManualCompLinks(needsManualComp ? "priority" : "compact")}
              {needsManualComp && renderCheckedCompCard("priority")}
              {dealerVerdict && (
                <div className={`dealer-verdict ${dealerVerdict.tone}`}>
                  <div className="dealer-verdict-main">
                    <span>{dealerVerdict.label}</span>
                    <strong>{dealerVerdict.title}</strong>
                    <small>{dealerVerdict.detail}</small>
                    {dealerVerdict.tone !== "good" && !checkedComp && (
                      <div className="dealer-verdict-actions">
                        <button type="button" onClick={() => openManualCompLink("EBAY_UK_SOLD")}>
                          Open UK
                        </button>
                        <button type="button" onClick={jumpToCheckedComp}>
                          Enter price
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="dealer-verdict-signal">
                    <span>Signals</span>
                    <strong>
                      {dealerVerdict.pricedSignalCount}/{dealerVerdict.totalSignalCount}
                    </strong>
                    <small>{dealerVerdictSignalMeta(dealerVerdict)}</small>
                  </div>
                </div>
              )}
              {!needsManualComp && deal && (
                <div className={`deal-banner ${deal.tone}`}>
                  <div>
                    <span>{quickStockCostPence > 0 ? "Deal judge" : "Buy ceiling"}</span>
                    <strong>{deal.label}</strong>
                  </div>
                  <div>
                    <span>{quickStockCostPence > 0 ? "Net profit" : "Offer up to"}</span>
                    <strong>{gbp(quickStockCostPence > 0 ? deal.expectedProfitPence : deal.targetBuyPence)}</strong>
                  </div>
                  <div>
                    <span>{quickStockCostPence > 0 ? "Target buy" : "List around"}</span>
                    <strong>{gbp(quickStockCostPence > 0 ? deal.targetBuyPence : quickStockListPence)}</strong>
                  </div>
                </div>
              )}
              {!needsManualComp && stockCompItem && stockCompSuggestion && (
                <div className="stock-reprice-card">
                  <div>
                    <span>Stock reprice</span>
                    <strong>{stockCompItem.card.name}</strong>
                    <small>
                      {stockCompListing
                        ? `Current ${gbp(stockCompListing.listPrice ?? stockCompListing.suggestedPrice ?? 0)} · suggested ${gbp(stockCompSuggestion.pricePence)}`
                        : `Suggested ${gbp(stockCompSuggestion.pricePence)} · no draft listing yet`}
                    </small>
                  </div>
                  {stockCompListing ? (
                    <button
                      type="button"
                      onClick={() => void applyStockCompReprice()}
                      disabled={busy === `listing-${stockCompListing.id}`}
                    >
                      {busy === `listing-${stockCompListing.id}` ? "Updating..." : "Update listing"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void listInventoryItem(stockCompItem)} disabled={busy?.startsWith("create-listing-")}>
                      Draft listing
                    </button>
                  )}
                </div>
              )}
              <div className="detail-grid">
                <Metric label="Range" value={`${gbp(headline.lowPence)}-${gbp(headline.highPence)}`} />
                {conditionAdjustedHeadlinePence != null && (
                  <Metric label="Raw value" value={gbp(conditionAdjustedHeadlinePence)} tone="warn" />
                )}
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
              {!needsManualComp && !shouldOfferManualComp && renderManualCompLinks()}
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
                        {gbp(sale.itemSubtotalPence ?? sale.salePricePence)} item · {shortDate(sale.soldAt)}
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
              {sourceMatchedCard && (
                <div className="catalog-strip source-match-strip">
                  <CardImage
                    src={null}
                    className="catalog-art"
                    fallbackClassName="catalog-art blank"
                    alt=""
                  />
                  <div>
                    <span>{sourceMatchSourceLabel} matched this card</span>
                    <strong>{sourceMatchedCard.name}</strong>
                    <small>
                      {sourceMatchedCard.setName ?? "No set"}
                      {sourceMatchedCard.number ? ` #${sourceMatchedCard.number}` : ""}
                    </small>
                    {sourceMatchTypedMeta && <small className="source-match-typed">Typed: {sourceMatchTypedMeta}</small>}
                    {!catalogCard && headline.medianPence > 0 && !checkedComp && (
                      <div className="source-match-actions" aria-label="Source match actions">
                        <button type="button" onClick={() => openManualCompLink("EBAY_UK_SOLD")}>
                          Open UK
                        </button>
                        <button type="button" onClick={jumpToCheckedComp}>
                          Enter price
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!catalogCard && headline.medianPence > 0 && (
                <p className="hint">
                  Source found a price, but catalog/art did not confirm the card. Verify bigger buys with a UK sold check.
                </p>
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
            <details className="panel optional-tool-panel grade-lab">
              <summary>
                <span>Optional</span>
                <strong>Grade lab</strong>
                <small>RAW to PSA 10 EV</small>
              </summary>
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
            </details>
          )}

          {headline && !needsManualComp && (
            <details className="panel optional-tool-panel watch-panel">
              <summary>
                <span>Optional</span>
                <strong>Buy target</strong>
                <small>{watches.filter((watch) => watch.active).length} watched</small>
              </summary>
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
              {buyTargetOptions.length > 1 && (
                <div className="buy-target-presets" aria-label="Buy target presets">
                  {buyTargetOptions.map((option) => (
                    <button
                      key={`${option.label}-${option.targetPence}`}
                      type="button"
                      className={option.alreadyUsing ? "selected" : ""}
                      onClick={() => setWatchTarget(penceToPounds(option.targetPence))}
                      disabled={option.alreadyUsing}
                      title={option.note}
                    >
                      <span>{option.label}</span>
                      <strong>{gbp(option.targetPence)}</strong>
                    </button>
                  ))}
                </div>
              )}
              <button className="secondary-action" type="button" onClick={createWatch} disabled={busy === "watch-create"}>
                {busy === "watch-create" ? "Saving watch..." : "Watch for buy price"}
              </button>
            </details>
          )}

          {hasBuyContext && (!headline || needsManualComp) && (
          <form
            className="panel fallback-stock-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void stockWithoutComp();
            }}
          >
            <div className="panel-heading">
              <h2>Stock this card</h2>
              <span className="muted">{quickStockListPence > 0 ? `List ${gbp(quickStockListPence)}` : "price later"}</span>
            </div>
            <div className="form-grid">
              <label>
                Cost
                <MoneyInput ref={costInputRef} value={cost} onChange={setCost} />
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
            {totalCostSplit && (
              <div className="split-cost-card">
                <div>
                  <span>Total paid</span>
                  <strong>
                    {gbp(quickStockCostPence)} / {quickStockQuantity}
                  </strong>
                  <small>
                    Ledger cost {gbp(totalCostSplit.unitCostPence)} each
                    {totalCostSplit.roundingDeltaPence
                      ? ` · ${totalCostSplit.roundingDeltaPence > 0 ? "+" : ""}${gbp(totalCostSplit.roundingDeltaPence)} rounding`
                      : ""}
                  </small>
                </div>
                <button type="button" onClick={applyTotalCostSplit}>
                  Split total
                </button>
              </div>
            )}
            <details className="buy-advanced-details">
              <summary>More stock and listing details</summary>
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
              <div className="listing-choice" role="group" aria-label="After stock listing choice">
                <button type="button" className={!shouldCreateListing ? "selected" : ""} onClick={() => setShouldCreateListing(false)}>
                  List later
                </button>
                <button
                  type="button"
                  className={shouldCreateListing && acquireListingState === "DRAFT" ? "selected" : ""}
                  onClick={() => {
                    setShouldCreateListing(true);
                    setAcquireListingState("DRAFT");
                  }}
                >
                  Draft
                </button>
                <button
                  type="button"
                  className={shouldCreateListing && acquireListingState === "ACTIVE" ? "selected" : ""}
                  onClick={() => {
                    setShouldCreateListing(true);
                    setAcquireListingState("ACTIVE");
                  }}
                >
                  Active
                </button>
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
            </details>
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
                    buyer total {gbp(buyPlan.unitGrossSalePence)} · fees {gbp(buyPlan.unitFeesPence)} · my post{" "}
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
            <button
              className="primary-action"
              type="submit"
              disabled={busy === "manual-stock" || !manualStockReady}
            >
              {busy === "manual-stock"
                ? "Stocking..."
                : shouldCreateListing
                  ? acquireListingState === "ACTIVE"
                    ? "Stock + active listing"
                    : "Stock + draft"
                  : "Stock now"}
            </button>
            {!manualStockReady && <p className="hint">Add card, cost and quantity to stock without an auto comp.</p>}
            {suggestion && (
              <p className="hint">
                Suggested list price {gbp(suggestion.pricePence)}. {suggestion.rationale}
              </p>
            )}
          </form>
          )}
          <details className="panel stock-import-panel" ref={stockImportDetailsRef}>
            <summary>
              <span>Opening stock import</span>
              <small>
                {stockImportHasText
                  ? `${stockImportPreview.rows.length} row${stockImportPreview.rows.length === 1 ? "" : "s"} · ${gbp(stockImportPreview.totalCostPence)}`
                  : "setup / bulk paste"}
              </small>
            </summary>
            <form className="stock-import-form" onSubmit={importStockRows} ref={stockImportRef}>
              <div className="panel-heading">
                <div>
                  <h2>Opening stock</h2>
                  <span className="muted">Paste existing stock rows when setting up.</span>
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
                  ref={stockImportTextareaRef}
                  value={stockImportText}
                  onChange={(event) => setStockImportText(event.target.value)}
                  placeholder={STOCK_IMPORT_EXAMPLE}
                  rows={4}
                />
              </label>
              <div className="stock-import-actions" aria-label="Opening stock shortcuts">
                <button type="button" onClick={() => void pasteStockImportRows()}>
                  Paste clipboard
                </button>
                {stockImportTemplates.map((template) => (
                  <button key={template.label} type="button" onClick={() => fillStockImportTemplate(template)}>
                    {template.label}
                  </button>
                ))}
              </div>
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
                    <>
                      <div className="stock-import-summary" aria-label="Opening stock import summary">
                        <span>
                          <strong>{stockImportPreview.totalQuantity}</strong>
                          cards
                        </span>
                        <span>
                          <strong>{stockImportPreview.listingCount}</strong>
                          drafts
                        </span>
                        <span>
                          <strong>{stockImportPreview.explicitListPriceCount}</strong>
                          priced
                        </span>
                      </div>
                      <div className="stock-import-rows">
                        {stockImportPreview.rows.slice(0, 3).map((row, index) => (
                          <span key={`${row.card.name}-${row.card.number ?? ""}-${index}`}>
                            {row.quantity}x {row.card.name} · {row.card.setName ?? "No set"} · {gbp(row.costBasisPence)}
                            {row.condition ? ` · ${row.condition}` : ""}
                            {row.graderCert ? ` · cert ${row.graderCert}` : ""}
                            {row.listPricePence != null ? ` · list ${gbp(row.listPricePence)}` : " · draft auto"}
                          </span>
                        ))}
                        {stockImportPreview.rows.length > 3 && <span>+{stockImportPreview.rows.length - 3} more</span>}
                      </div>
                    </>
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
          </details>
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
                        <button type="button" onClick={() => loadRecentBuy(item, { repeatBuy: true })} aria-label={`Buy ${item.card.name} again`}>
                          Again
                        </button>
                        <button
                          type="button"
                          onClick={() => loadRecentBuy(item, { lookupAfter: true })}
                          disabled={busy === "lookup"}
                          aria-label={`Comp ${item.card.name}`}
                        >
                          Comp
                        </button>
                        <button type="button" onClick={() => openRecentListingWork(item)} aria-label={`${listing ? "Open pack for" : "List"} ${item.card.name}`}>
                          {listing ? "Pack" : "List"}
                        </button>
                        <button type="button" onClick={() => sellRecentBuy(item)} disabled={item.status === "SOLD"} aria-label={`Sell ${item.card.name}`}>
                          Sell
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {(headline || name.trim() || setNameValue.trim() || number.trim() || checkedComp) && (
            <div className="mobile-buy-spacer" aria-hidden="true" />
          )}
        </section>
      )}

      {view === "inventory" && (
        <section className="workspace inventory-workspace">
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
              onComp={compInventoryItem}
              onList={listInventoryItem}
              onPack={openRecentListingWork}
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
                  onComp={compInventoryItem}
                  onList={listInventoryItem}
                  onPack={openRecentListingWork}
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
                  src={firstSaleListingTarget.item.card.imageUrl}
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
                    onDraft={listInventoryItem}
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
          {ebayStatus !== null && !ebayStatus.connected && listings.some((l) => l.channel === "EBAY") && (
            <div className="ebay-setup-banner">
              {!ebayStatus.configured ? (
                <span>eBay credentials not configured — set env vars to enable API automation.</span>
              ) : ebayNeedsReconnect ? (
                <>
                  <span>eBay connection expired — reconnect your seller account to create offers.</span>
                  <a href="/api/ebay/connect">Reconnect eBay</a>
                </>
              ) : (
                <>
                  <span>eBay not connected — authorise your seller account to enable offer creation.</span>
                  <a href="/api/ebay/connect">Connect eBay</a>
                </>
              )}
            </div>
          )}
          {ebayNeedsMerchantLocation && listings.some((l) => l.channel === "EBAY") && (
            <div className="ebay-setup-banner">
              <span>
                eBay is connected and policies are ready. Add your dispatch location once, then offer creation can run from listing packs.
              </span>
              <form className="ebay-location-form" onSubmit={(event) => void createEbaySellerLocation(event)}>
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
              </form>
              <a href="https://www.ebay.co.uk/sh/landing" target="_blank" rel="noreferrer">
                Open Seller Hub
              </a>
            </div>
          )}
          {ebayPublishTarget !== null && (() => {
            const pl = listings.find((l) => l.id === ebayPublishTarget);
            return pl ? (
              <div className="ebay-publish-overlay">
                <div className="ebay-publish-confirm">
                  <div className="ebay-publish-card">
                    <CardImage
                      src={pl.item?.card.imageUrl ?? null}
                      className="mini-card-art"
                      fallbackClassName="mini-card-art blank"
                      alt=""
                    />
                    <p>
                      <strong>Publish to eBay?</strong>
                      <small>{pl.title ?? pl.item?.card.name ?? "Untitled listing"}</small>
                      <span>
                        {pl.item?.card.setName ? `${pl.item.card.setName} · ` : ""}
                        {pl.item?.grade?.replace(/_/g, " ") ?? "Ungraded"}
                        {pl.item?.quantity && pl.item.quantity > 1 ? ` · qty ${pl.item.quantity}` : ""}
                        {" · "}
                        {gbp(pl.listPrice ?? pl.suggestedPrice ?? 0)}
                      </span>
                    </p>
                  </div>
                  <div>
                    <button
                      className="primary-action"
                      type="button"
                      disabled={busy === `ebay-publish-${pl.id}`}
                      onClick={() => void publishEbayListing(pl.id)}
                    >
                      {busy === `ebay-publish-${pl.id}` ? "Publishing..." : "Yes, publish live"}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setEbayPublishTarget(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : null;
          })()}
          {visibleListings.map((listing) => (
            <ListingRow
              key={listing.id}
              listing={listing}
              busy={busy}
              ebayConnected={Boolean(ebayStatus?.connected)}
              onEdit={openListingEditor}
              onPack={openListingPack}
              onSell={openSellFromListing}
              onPasteUrl={() => void pasteListingUrlForListing(listing)}
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
              busy={busy === `listing-${listingPackTarget.id}` ||
                busy === `ebay-preflight-${listingPackTarget.id}` ||
                busy === `ebay-offer-${listingPackTarget.id}` ||
                busy === `ebay-publish-${listingPackTarget.id}`}
              nextListingLabel={nextListingPackTarget ? listingQueueLabel(nextListingPackTarget) : null}
              ebayStatus={ebayStatus}
              ebayPreflight={ebayPreflight?.listingId === listingPackTarget.id ? ebayPreflight : null}
              onCopy={copyListingPack}
              onCopyAndOpen={copyListingPackAndOpenVenue}
              onCopyField={copyListingPackField}
              onActivate={activateListingPackTarget}
              onPasteLiveUrl={pasteListingUrlAndActivate}
              onSell={openSellFromListingPack}
              onNext={openNextListingPack}
              onPreflight={() => void runEbayPreflight(listingPackTarget.id)}
              onCreateOffer={() => void createEbayOfferForListing(listingPackTarget.id)}
              onRequestPublish={() => setEbayPublishTarget(listingPackTarget.id)}
              onClose={() => {
                setListingPackId(null);
                setListingPackCopied(false);
                setListingPackCopiedField(null);
                setEbayPublishTarget(null);
              }}
            />
          )}
        </section>
      )}

      {view === "pnl" && (
        <section className="workspace pnl-workspace">
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
          <section className="panel expense-panel" ref={expensePanelRef}>
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
                  ref={expenseDescriptionRef}
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
          <section className="panel watch-panel" ref={pnlWatchPanelRef}>
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
              {sellingListing && (
                <span className="muted">
                  {channelLabel(sellingListing.channel)} listing ·{" "}
                  {gbp(sellingListing.listPrice ?? sellingListing.suggestedPrice ?? 0)}
                </span>
              )}
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setSellingId(null);
                setSellingListingId(null);
              }}
            >
              Close
            </button>
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
          <SalePromptCard
            prompt={salePrompt}
            busy={busy === `sell-${sellingId}`}
            onPasteGross={() => void pasteSaleTotalPrice()}
          />
          <div className="sale-shortcuts" aria-label="Sale shortcuts">
            <div className="sale-shortcut-group">
              <span>Price</span>
              <div>
                <button type="button" onClick={useListingSalePrice} disabled={!sellingItem}>
                  Listing total
                </button>
                <button type="button" onClick={() => void pasteSaleTotalPrice()}>
                  Paste total
                </button>
                <button type="button" onClick={() => void pasteSaleNetPrice()}>
                  Paste net
                </button>
                {sellingItem && sellingItem.quantity > 1 && (
                  <button type="button" onClick={sellAllQuantity}>
                    All qty
                  </button>
                )}
              </div>
            </div>
            <div className="sale-shortcut-group">
              <span>Offers</span>
              <div>
                <button type="button" onClick={() => applySalePriceDiscount(100)} disabled={!sellingItem}>
                  -£1
                </button>
                <button type="button" onClick={() => applySalePriceDiscount(500)} disabled={!sellingItem}>
                  -£5
                </button>
                <button type="button" onClick={() => applySalePriceMultiplier(0.95)} disabled={!sellingItem}>
                  95%
                </button>
                <button type="button" onClick={() => applySalePriceMultiplier(0.9)} disabled={!sellingItem}>
                  90%
                </button>
                <button type="button" onClick={() => applySalePriceMultiplier(0.85)} disabled={!sellingItem}>
                  85%
                </button>
                <button type="button" onClick={() => applySalePriceMultiplier(0.8)} disabled={!sellingItem}>
                  80%
                </button>
              </div>
            </div>
            <div className="sale-shortcut-group">
              <span>Targets</span>
              <div>
                <button type="button" onClick={useBreakEvenSalePrice} disabled={!sellingItem}>
                  Break even
                </button>
                <button type="button" onClick={() => applySaleTargetProfit(500)} disabled={!sellingItem}>
                  £5 profit
                </button>
                <button type="button" onClick={() => applySaleTargetProfit(1000)} disabled={!sellingItem}>
                  £10 profit
                </button>
                <button type="button" onClick={() => applySaleTargetRoi(0.3)} disabled={!sellingItem}>
                  30% ROI
                </button>
                <button type="button" onClick={() => applySaleTargetRoi(0.5)} disabled={!sellingItem}>
                  50% ROI
                </button>
              </div>
            </div>
            <div className="sale-shortcut-group">
              <span>Costs</span>
              <div>
                <button type="button" onClick={applyCashSale}>
                  Cash
                </button>
                <button type="button" onClick={resetSaleCosts}>
                  Default costs
                </button>
                <button type="button" onClick={clearSalePostage}>
                  My post £0
                </button>
              </div>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Buyer total
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
                onChange={(event) => changeSaleQuantity(event.target.value)}
              />
            </label>
          </div>
          {saleBreakdown && (
            <div className="sale-breakdown" aria-label="Sale price breakdown">
              <div>
                <span>Items</span>
                <strong>{gbp(saleBreakdown.itemSubtotalPence)}</strong>
                <small>
                  {saleBreakdown.quantity} x {gbp(saleBreakdown.unitItemPence)}
                </small>
              </div>
              <div>
                <span>Buyer post</span>
                <strong>{gbp(saleBreakdown.postagePaidPence)}</strong>
                <small>{saleBreakdown.postagePaidPence > 0 ? "charged to buyer" : "none charged"}</small>
              </div>
              <div>
                <span>Total</span>
                <strong>{gbp(saleBreakdown.grossPence)}</strong>
                <small>what buyer paid</small>
              </div>
            </div>
          )}
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
            My postage cost
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
              Default buyer total includes {gbp(buyerPaidPostagePence(saleChannel, sellingItem.grade))} postage, then deducts your postage cost below.
            </p>
          )}
          {salePreview && (
            <div className={`sale-preview ${salePreview.profitPence >= 0 ? "good" : "warn"}`}>
              <div>
                <span>Net</span>
                <strong>{gbp(salePreview.netPence)}</strong>
                <small>After fees + my post</small>
              </div>
              <div>
                <span>Cost</span>
                <strong>{gbp(salePreview.costPence)}</strong>
                <small>{salePreview.soldQuantity} sold</small>
              </div>
              <div>
                <span>Profit</span>
                <strong>{gbp(salePreview.profitPence)}</strong>
                <small>{formatPct(salePreview.roiPct)} ROI · {formatPct(salePreview.marginPct)} margin</small>
              </div>
            </div>
          )}
          <div className="sale-submit-row">
            <button className="primary-action" type="submit" value="done" disabled={busy === `sell-${sellingId}`}>
              {busy === `sell-${sellingId}` ? "Saving..." : "Create sale"}
            </button>
            {nextSaleAfterCurrentTarget && (
              <button className="secondary-action" type="submit" value="next" disabled={busy === `sell-${sellingId}`}>
                Save + next
              </button>
            )}
          </div>
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

      {view === "acquire" && (headline || name.trim() || setNameValue.trim() || number.trim() || checkedComp) && (
        <section className={`mobile-buy-action ${buyPlan?.tone ?? deal?.tone ?? "warn"}`} aria-label="Current buy action">
          <div>
            <span>{headline ? confidenceLabel?.label ?? "Comp" : "Manual card"}</span>
            <strong>{headline ? (needsManualComp ? "Check solds" : gbp(headline.medianPence)) : "No auto comp"}</strong>
            <small>
              {!headline
                ? manualStockReady
                  ? "stock manually now, price/list later if needed"
                  : "open UK solds or add cost and quantity"
                : needsManualComp
                ? mobileCanStockLater
                  ? "open UK solds or stock now, price later"
                  : "open UK solds, then enter checked price"
                : requiresCheckedCompBeforeStock && mobileCanStockLater
                  ? "enter checked price or stock now, price later"
                : quickStockReady
                ? `${quickStockQuantity} @ ${gbp(quickStockCostPence)} · ${
                    requiresCheckedCompBeforeStock ? "check solds" : deal?.label ?? "ready"
                  }`
                : "add cost and quantity"}
            </small>
          </div>
          <button
            className="mobile-skip-button"
            type="button"
            onClick={!headline ? () => clearCurrentComp() : mobileCanStockLater ? () => void stockWithoutComp() : mobileNeedsCheckedComp ? jumpToCheckedComp : skipCurrentComp}
            disabled={busy === "acquire" || busy === "manual-stock"}
          >
            {!headline ? "Next" : mobileCanStockLater ? (busy === "manual-stock" ? "Stocking..." : "Stock now") : mobileNeedsCheckedComp ? "Enter price" : "Next"}
          </button>
          <button
            className="primary-action"
            type="button"
            onClick={!headline ? (manualStockReady ? () => void stockWithoutComp() : () => openManualCompLink("EBAY_UK_SOLD")) : needsManualComp ? () => openManualCompLink("EBAY_UK_SOLD") : runStockAction}
            disabled={
              busy === "acquire" ||
              busy === "manual-stock" ||
              (!headline && !manualStockReady && !manualCompFallbackQuery.trim()) ||
              Boolean(headline && !needsManualComp && quickStockReady && !quickStockCanSubmit)
            }
          >
            {!headline
              ? manualStockReady
                ? busy === "manual-stock"
                  ? "Stocking..."
                  : "Stock now"
                : "Open UK"
              : needsManualComp
              ? "Open UK"
              : busy === "acquire"
              ? "Stocking..."
              : !quickStockReady
                ? "Add cost"
                : requiresCheckedCompBeforeStock
                  ? "Add checked comp first"
                  : stockButtonLabel}
          </button>
        </section>
      )}

      <nav className="bottom-nav" aria-label="Primary">
        <TabButton active={view === "acquire"} label="Buy" onClick={() => setView("acquire")} />
        <TabButton active={view === "inventory"} label="Inventory" onClick={() => setView("inventory")} />
        <TabButton active={view === "listings"} label="Listings" onClick={() => setView("listings")} />
        <TabButton active={view === "pnl"} label="P&L" onClick={() => setView("pnl")} />
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
  ebayStatus,
  ebayPreflight,
  onCopy,
  onCopyField,
  onActivate,
  onSell,
  onNext,
  onClose,
  onPreflight,
  onCreateOffer,
  onRequestPublish,
  onCopyAndOpen,
  onPasteLiveUrl,
}: {
  listing: Listing;
  pack: ListingPack;
  copied: boolean;
  copiedField: string | null;
  busy: boolean;
  nextListingLabel: string | null;
  ebayStatus: EbayStatus | null;
  ebayPreflight: EbayPreflight | null;
  onCopy: () => void;
  onCopyField: (field: ListingPackCopyField) => void;
  onActivate: () => void;
  onSell: (listing: Listing) => void;
  onNext: () => void;
  onClose: () => void;
  onPreflight: () => void;
  onCreateOffer: () => void;
  onRequestPublish: () => void;
  onCopyAndOpen: () => void;
  onPasteLiveUrl: () => void;
}) {
  const item = listing.item;
  const specifics = Object.entries(pack.itemSpecifics);
  const copyFields = listingPackCopyFields(pack);
  const venueAction = listingVenueAction(listing.channel, { query: listingPackSearchQuery(listing, pack) });
  const canSell = Boolean(item && item.status !== "SOLD" && listing.state !== "SOLD");
  const economics = item
    ? buildListingEconomics({
        channel: listing.channel,
        grade: item.grade,
        itemPricePence: pack.suggestedPricePence,
        costBasisPence: item.costBasis,
      })
    : null;

  const isEbayListing = listing.channel === "EBAY";
  const hasOffer = Boolean(listing.externalRef?.startsWith("offer:"));
  const isPublished = Boolean(listing.externalRef && !listing.externalRef.startsWith("offer:") && listing.externalUrl);
  // eBay listings can only be marked active via the real publish flow (or by
  // pasting a genuine live URL) — never via this generic shortcut.
  const canActivate = listing.state === "DRAFT" && !(isEbayListing && !isPublished);

  const ebayReadiness = isEbayListing
    ? checkEbayReadiness({
        ebayConfigured: Boolean(ebayStatus?.configured),
        ebayConnected: Boolean(ebayStatus?.connected),
        channel: listing.channel,
        listingState: listing.state,
        pricePence: listing.listPrice ?? listing.suggestedPrice ?? null,
        externalRef: listing.externalRef,
        hasMerchantLocation: Boolean(ebayStatus?.hasMerchantLocation || ebayStatus?.policies?.merchantLocationKey),
        hasImage: Boolean(listing.item?.card.imageUrl),
      })
    : null;
  const ebayOfferReady = ebayReadiness?.offerReady ?? false;
  const sellingSteps = buildListingSellFlow({
    channel: listing.channel,
    state: listing.state,
    externalRef: listing.externalRef,
    externalUrl: listing.externalUrl,
    ebayReady: ebayOfferReady,
    sellable: canSell,
  });
  const nextAction = buildListingNextAction({
    channel: listing.channel,
    state: listing.state,
    externalRef: listing.externalRef,
    externalUrl: listing.externalUrl,
    ebayReady: ebayOfferReady,
    sellable: canSell,
    hasVenueAction: Boolean(venueAction),
    packCopied: copied,
  });

  function runNextAction() {
    if (nextAction.id === "copy-open") {
      onCopyAndOpen();
      return;
    }
    if (nextAction.id === "copy-only") {
      onCopy();
      return;
    }
    if (nextAction.id === "paste-url") {
      onPasteLiveUrl();
      return;
    }
    if (nextAction.id === "activate") {
      onActivate();
      return;
    }
    if (nextAction.id === "create-offer") {
      onCreateOffer();
      return;
    }
    if (nextAction.id === "publish") {
      onRequestPublish();
      return;
    }
    if (nextAction.id === "record-sale") {
      onSell(listing);
    }
  }

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
      {economics && (
        <div className={`listing-economics ${economics.profitPence >= 0 ? "good" : "warn"}`}>
          <div>
            <span>Net after sale</span>
            <strong>{gbp(economics.netPence)}</strong>
            <small>
              Buyer total {gbp(economics.grossPence)} · fees {gbp(economics.feesPence)} · my post {gbp(economics.postagePence)}
            </small>
          </div>
          <div>
            <span>Cost</span>
            <strong>{gbp(economics.costPence)}</strong>
            <small>{item?.quantity && item.quantity > 1 ? "Per copy" : "Stock cost"}</small>
          </div>
          <div>
            <span>Profit</span>
            <strong>{gbp(economics.profitPence)}</strong>
            <small>
              {economics.roiPct == null ? "n/a ROI" : `${economics.roiPct}% ROI`}
              {" · "}
              {economics.marginPct == null ? "n/a margin" : `${economics.marginPct}% margin`}
            </small>
          </div>
        </div>
      )}
      <ListingNextActionCard action={nextAction} busy={busy} onRun={runNextAction} />
      <ListingFlowSteps steps={sellingSteps} />
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
        {venueAction && (
          <button className="primary-action" type="button" onClick={onCopyAndOpen} disabled={busy}>
            {busy ? "Working..." : "Copy + open"}
          </button>
        )}
        <button className={venueAction ? "ghost-button" : "primary-action"} type="button" onClick={onCopy}>
          {copied ? "Copied" : venueAction ? "Copy only" : "Copy listing pack"}
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
        {listing.externalUrl ? (
          <a className="export-link" href={listing.externalUrl} target="_blank" rel="noreferrer">
            View live
          </a>
        ) : (
          <button className="ghost-button" type="button" onClick={onPasteLiveUrl} disabled={busy}>
            Paste URL + active
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
      {isEbayListing && ebayReadiness && (
        <div className="listing-pack-ebay-actions">
          {!isPublished && (
            <button
              className="ghost-button"
              type="button"
              onClick={onPreflight}
              disabled={busy || !ebayReadiness.ready}
            >
              {busy ? "Checking..." : "Preflight eBay offer"}
            </button>
          )}
          {ebayPreflight && <EbayPreflightCard preflight={ebayPreflight} />}
          {isPublished ? (
            <a
              className="export-link"
              href={listing.externalUrl!}
              target="_blank"
              rel="noreferrer"
            >
              View on eBay
            </a>
          ) : hasOffer ? (
            <button
              className="ghost-button"
              type="button"
              onClick={onRequestPublish}
              disabled={busy}
            >
              {busy ? "Working..." : "Publish to eBay"}
            </button>
          ) : ebayOfferReady ? (
            <button
              className="ghost-button"
              type="button"
              onClick={onCreateOffer}
              disabled={busy}
            >
              {busy ? "Creating offer..." : "Create eBay offer"}
            </button>
          ) : (
            <button
              className="ghost-button"
              type="button"
              onClick={onCreateOffer}
              disabled={busy || !ebayOfferReady}
            >
              {busy ? "Creating offer..." : "Create eBay offer"}
            </button>
          )}
          <ul className="ebay-readiness-list">
            {ebayReadiness.checks.map((check) => (
              <li key={check.key} className={`readiness-${check.status}`}>
                <span className="readiness-icon">
                  {check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗"}
                </span>
                <span>
                  {check.label}
                  {check.detail && check.status !== "pass" ? ` — ${check.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

function listingPackSearchQuery(listing: Listing, pack: ListingPack): string {
  const card = listing.item?.card;
  return [card?.name, card?.number, card?.setName].filter(Boolean).join(" ").trim() || pack.title;
}

function EbayPreflightCard({ preflight }: { preflight: EbayPreflight }) {
  const policyCount = [
    preflight.policyKeys.paymentPolicyId,
    preflight.policyKeys.fulfillmentPolicyId,
    preflight.policyKeys.returnPolicyId,
  ].filter(Boolean).length;

  return (
    <div className="ebay-preflight-card">
      <div>
        <span>Preflight passed</span>
        <strong>{preflight.writesToEbay ? "Will write on next action" : "No eBay write made"}</strong>
      </div>
      <dl>
        <div>
          <dt>SKU</dt>
          <dd>{preflight.sku}</dd>
        </div>
        <div>
          <dt>Marketplace</dt>
          <dd>{preflight.marketplaceId}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>£{preflight.priceGbp}</dd>
        </div>
        <div>
          <dt>Qty</dt>
          <dd>{preflight.quantity}</dd>
        </div>
        <div>
          <dt>Image</dt>
          <dd>{preflight.hasImage ? "ready" : "missing"}</dd>
        </div>
        <div>
          <dt>Policies</dt>
          <dd>{policyCount}/3 ready</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{preflight.policyKeys.merchantLocationKey ? "ready" : "not returned"}</dd>
        </div>
      </dl>
      <p>
        {preflight.existingOfferId ? "An existing eBay offer was found for this SKU." : "Ready to create a new eBay offer."}
        {!preflight.policyKeys.merchantLocationKey
          ? " If eBay rejects create, add or refresh the seller location in eBay business settings."
          : ""}
      </p>
    </div>
  );
}

function ListingNextActionCard({
  action,
  busy,
  onRun,
}: {
  action: ListingNextAction;
  busy: boolean;
  onRun: () => void;
}) {
  const done = action.id === "done";
  return (
    <div className={`listing-next-action ${done ? "done" : ""}`}>
      <div>
        <span>Next listing step</span>
        <strong>{action.title}</strong>
        <small>{action.detail}</small>
      </div>
      <button type="button" onClick={onRun} disabled={busy || done}>
        {busy ? "Working..." : action.cta}
      </button>
    </div>
  );
}

function SalePromptCard({
  prompt,
  busy,
  onPasteGross,
}: {
  prompt: SalePrompt;
  busy: boolean;
  onPasteGross: () => void;
}) {
  const needsPrice = prompt.action === "paste-total";
  return (
    <div className={`sale-prompt-card ${prompt.tone}`}>
      <div>
        <span>Sale step</span>
        <strong>{prompt.title}</strong>
        <small>{prompt.detail}</small>
      </div>
      <button
        type={needsPrice ? "button" : "submit"}
        value={needsPrice ? undefined : "done"}
        disabled={busy}
        onClick={needsPrice ? onPasteGross : undefined}
      >
        {busy ? "Saving..." : prompt.cta}
      </button>
    </div>
  );
}

function ListingFlowSteps({ steps }: { steps: ListingFlowStep[] }) {
  return (
    <ol className="listing-flow-steps" aria-label="Selling steps">
      {steps.map((step, index) => (
        <li key={step.id} className={`listing-flow-step ${step.state}`}>
          <span>{index + 1}</span>
          <div>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

function InventoryRow({
  item,
  busy,
  onEdit,
  onSell,
  onComp,
  onList,
  onPack,
  onStatus,
  onDelete,
}: {
  item: InventoryItem;
  busy: string | null;
  onEdit: (item: InventoryItem) => void;
  onSell: (item: InventoryItem) => void;
  onComp: (item: InventoryItem) => void;
  onList: (item: InventoryItem) => void;
  onPack: (item: InventoryItem) => void;
  onStatus: (item: InventoryItem, status: ItemStatus) => void;
  onDelete: (item: InventoryItem) => void;
}) {
  const listing = item.listings[0];
  const draftListing = item.listings.find((row) => row.state === "DRAFT");
  const activeListing = item.listings.find((row) => row.state === "ACTIVE");
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
          {item.status !== "SOLD" && (
            <div className="next-action-strip">
              {draftListing ? (
                <button className="next-action-button" type="button" onClick={() => onPack(item)}>
                  Open listing pack
                </button>
              ) : activeListing ? (
                <button className="next-action-button good" type="button" onClick={() => onSell(item)} disabled={busy?.startsWith("sell-")}>
                  Record sale
                </button>
              ) : (
                <button
                  className="next-action-button"
                  type="button"
                  onClick={() => onList(item)}
                  disabled={busy === `status-${item.id}` || busy?.startsWith("listing-") || busy?.startsWith("create-listing-")}
                >
                  Draft listing
                </button>
              )}
              <span>
                {draftListing
                  ? `${channelLabel(draftListing.channel)} draft ready`
                  : activeListing
                    ? `${channelLabel(activeListing.channel)} active at ${gbp(activeListing.listPrice ?? activeListing.suggestedPrice ?? 0)}`
                    : "Not listed yet"}
              </span>
            </div>
          )}
          <div className="row-actions">
            {item.status !== "SOLD" && (
              <button type="button" onClick={() => onComp(item)} disabled={busy === "lookup"}>
                Comp
              </button>
            )}
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
            Draft + pack
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
  ebayConnected,
  onEdit,
  onPack,
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

function NextMoveCard({
  action,
  progress,
  onOpen,
}: {
  action: TodayAction;
  progress: LaunchProgress;
  onOpen: (target: TodayActionTarget) => void;
}) {
  return (
    <button className={`next-move-card ${action.tone}`} type="button" onClick={() => onOpen(action.target)}>
      <span className="next-move-kicker">Next move · {progress.label}</span>
      <span className="next-move-main">
        <strong>{action.title}</strong>
        <b aria-hidden="true">›</b>
      </span>
      <small>{action.detail}</small>
    </button>
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
        {source.setupHint && <small>{source.setupHint}</small>}
      </div>
      <span>{sourceStatusLabel(source.status)}</span>
    </div>
  );
}

function IntakeSessionCard({
  source,
  location,
  condition,
  channel,
  listingState,
  keepBuying,
  onSourceChange,
  onLocationChange,
  onConditionChange,
  onChannelChange,
  onListingStateChange,
  onKeepBuyingChange,
}: {
  source: string;
  location: string;
  condition: string;
  channel: Channel;
  listingState: AcquireListingState;
  keepBuying: boolean;
  onSourceChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onConditionChange: (value: string) => void;
  onChannelChange: (value: Channel) => void;
  onListingStateChange: (value: AcquireListingState) => void;
  onKeepBuyingChange: (value: boolean) => void;
}) {
  return (
    <div className="intake-session-card" aria-label="Buy session defaults">
      <div className="intake-session-heading">
        <div>
          <span>Buy session</span>
          <strong>
            {source || "Source"} · {location || "Place"} · {condition || "Condition"}
          </strong>
        </div>
        <div className="intake-session-mode" role="group" aria-label="After stock">
          <button type="button" className={keepBuying ? "selected" : ""} onClick={() => onKeepBuyingChange(true)}>
            Next
          </button>
          <button type="button" className={!keepBuying ? "selected" : ""} onClick={() => onKeepBuyingChange(false)}>
            Done
          </button>
        </div>
      </div>
      <div className="intake-session-mode wide" role="group" aria-label="Listing defaults">
        {channels.map((option) => (
          <button
            key={option}
            type="button"
            className={channel === option ? "selected" : ""}
            onClick={() => onChannelChange(option)}
          >
            {channelLabel(option)}
          </button>
        ))}
        <button type="button" className={listingState === "DRAFT" ? "selected" : ""} onClick={() => onListingStateChange("DRAFT")}>
          Draft
        </button>
        <button type="button" className={listingState === "ACTIVE" ? "selected" : ""} onClick={() => onListingStateChange("ACTIVE")}>
          Active
        </button>
      </div>
      <div className="intake-session-presets" aria-label="Source presets">
        {sourcePresets.map((preset) => (
          <button key={preset} type="button" className={source === preset ? "selected" : ""} onClick={() => onSourceChange(preset)}>
            {preset}
          </button>
        ))}
      </div>
      <div className="intake-session-presets compact" aria-label="Location and condition presets">
        {locationPresets.map((preset) => (
          <button key={preset} type="button" className={location === preset ? "selected" : ""} onClick={() => onLocationChange(preset)}>
            {preset}
          </button>
        ))}
        {conditionPresets.map((preset) => (
          <button key={preset} type="button" className={condition === preset ? "selected" : ""} onClick={() => onConditionChange(preset)}>
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}

function OperatingSnapshotCard({ row }: { row: OperatingSnapshotRow }) {
  return (
    <div className={`operating-snapshot-card ${row.tone}`}>
      <span>{row.label}</span>
      <strong>{row.value}</strong>
      <small>{row.detail}</small>
    </div>
  );
}

function LastStockedPanel({
  card,
  onPack,
  onSell,
  onNext,
  onDismiss,
}: {
  card: LastStockedCard;
  onPack: () => void;
  onSell: () => void;
  onNext: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="last-stocked-panel" aria-label="Last stocked card">
      <CardImage src={card.imageUrl} className="mini-card-art" fallbackClassName="mini-card-art blank" alt="" />
      <div className="last-stocked-copy">
        <span>Last stocked</span>
        <strong>{card.name}</strong>
        <small>
          {card.setName}
          {card.number ? ` #${card.number}` : ""} · {card.grade.replace(/_/g, " ")}
        </small>
        <small>
          {card.quantity} @ {gbp(card.costPence)} ·{" "}
          {card.listingId
            ? `${channelLabel(card.channel)} ${card.listingState.toLowerCase()} ${gbp(card.listPricePence)}`
            : "not listed"}
        </small>
      </div>
      <div className="last-stocked-actions">
        <button type="button" onClick={onPack} disabled={!card.listingId}>
          Pack
        </button>
        <button type="button" onClick={onSell}>
          Sell
        </button>
        <button type="button" onClick={onNext}>
          Next
        </button>
        <button className="danger-button" type="button" onClick={onDismiss} aria-label="Dismiss last stocked card">
          x
        </button>
      </div>
    </section>
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

const MoneyInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}>(function MoneyInput({
  value,
  onChange,
  disabled = false,
  placeholder,
}, ref) {
  return (
    <span className="money-input">
      <span aria-hidden="true">£</span>
      <input
        ref={ref}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </span>
  );
});

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

function dealerVerdictSignalMeta(verdict: DealerCompVerdict): string {
  const spread = verdict.spreadPct == null ? "single price" : `${verdict.spreadPct}% spread`;
  if (verdict.tone === "good" || verdict.buyCeilingPence == null) return spread;
  return `${spread} · ceiling ${gbp(verdict.buyCeilingPence)}`;
}

function recentCompMeta(entry: RecentCompEntry): string {
  const sample =
    entry.sampleSize > 0 && entry.windowDays > 0
      ? `${entry.sampleSize}/${entry.windowDays}d`
      : "no sample";
  return `${sourceLabel(entry.source, false)} · ${sample} · ${ageLabel(entry.lookedUpAt)}`;
}

function hideBrokenImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true;
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
  if (view === "today") return "Status";
  if (view === "acquire") return "Buy cards";
  if (view === "inventory") return "Inventory";
  if (view === "listings") return "Listings";
  return "P&L";
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

function catalogSuggestionMeta(card: CatalogCard): string {
  return `${card.setName}${card.number ? ` #${card.number}` : " · manual identity"}`;
}

function cardIdentitySearchText(
  card: { name: string; setName: string; number?: string | null },
  grade: Grade,
  condition?: string,
): string {
  const gradeText = grade === "RAW" ? "raw" : grade.replace(/_/g, " ");
  const cleanCondition = condition?.trim();
  return [
    card.name,
    card.setName,
    card.number ?? "",
    gradeText,
    cleanCondition && cleanCondition.toUpperCase() !== "NM" ? cleanCondition : "",
  ]
    .filter(Boolean)
    .join(" ");
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
