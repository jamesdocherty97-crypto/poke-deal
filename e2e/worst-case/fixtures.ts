/**
 * Example data only. These fixtures never come from a live provider, a
 * database, or a real stock book. Every price is invented for layout stress.
 *
 * Modes: Demo data / Worst case / Empty / One / 1,000 rows / Slow / Error.
 * Dev-only. Not imported by the app.
 */

export const FIXTURE_LABEL = "Example data";

export type WorstCaseMode = "demo" | "worst" | "empty" | "one" | "thousand" | "slow" | "error";

const NOW = "2026-10-21T08:00:00.000Z";
const YESTERDAY = "2026-10-20T16:30:00.000Z";
const LONG_AGO = "2024-01-02T00:00:00.000Z";

function minutesBefore(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) - minutes * 60_000).toISOString();
}
const BROKEN_IMAGE = "https://example.invalid/missing-card.jpg";

type Card = {
  id: string;
  name: string;
  setName: string;
  number: string | null;
  imageUrl: string | null;
  displayImageUrl?: string | null;
  language?: "EN" | "JP";
  game?: string;
};

type Photo = {
  id: string;
  url: string;
  role: "FRONT";
  origin: "REAL" | "CATALOG";
  width: number | null;
  height: number | null;
  order: number;
  createdAt: string;
};

type Item = {
  id: string;
  card: Card;
  grade: string;
  quantity: number;
  costBasis: number;
  acquiredFrom: string | null;
  location: string | null;
  condition: string | null;
  graderCert: string | null;
  status: "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
  createdAt: string;
  acquiredAt?: string;
  updatedAt: string;
  listings: Listing[];
  sales: Array<Record<string, unknown>>;
  photos: Photo[];
};

type Listing = {
  id: string;
  itemId: string;
  channel: "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
  state: "DRAFT" | "ACTIVE" | "SOLD" | "ENDED";
  title: string | null;
  suggestedPrice: number | null;
  listPrice: number | null;
  externalRef: string | null;
  externalUrl: string | null;
  listedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  item?: Item;
};

function photo(id: string, url: string): Photo {
  return { id, url, role: "FRONT", origin: "REAL", width: 245, height: 342, order: 0, createdAt: NOW };
}

function item(partial: Partial<Item> & Pick<Item, "id" | "card">): Item {
  return {
    grade: "RAW",
    quantity: 1,
    costBasis: 2500,
    acquiredFrom: null,
    location: null,
    condition: null,
    graderCert: null,
    status: "IN_STOCK",
    createdAt: NOW,
    updatedAt: NOW,
    listings: [],
    sales: [],
    photos: [],
    ...partial,
  };
}

function listing(partial: Partial<Listing> & Pick<Listing, "id" | "itemId" | "title">, owner: Item): Listing {
  const row: Listing = {
    channel: "EBAY",
    state: "DRAFT",
    suggestedPrice: owner.costBasis,
    listPrice: owner.costBasis,
    externalRef: null,
    externalUrl: null,
    listedAt: null,
    endedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
  owner.listings.push(row);
  return row;
}

function demoBook(): { items: Item[]; listings: Listing[] } {
  const gengar = item({
    id: "example-demo-gengar",
    card: {
      id: "example-demo-gengar-card",
      name: "Gengar",
      setName: "Lost Origin",
      number: "TG06/TG30",
      imageUrl: null,
      language: "EN",
    },
    grade: "RAW",
    quantity: 1,
    costBasis: 2500,
    acquiredFrom: "Card fair",
    location: "Trade box",
    condition: "NM",
    status: "IN_STOCK",
  });
  const draft = listing({
    id: "example-demo-gengar-listing",
    itemId: gengar.id,
    title: "Gengar TG06/TG30 Lost Origin Pokemon Card RAW",
    state: "DRAFT",
    suggestedPrice: 4499,
    listPrice: 4499,
  }, gengar);
  return { items: [gengar], listings: [withItem(draft, gengar)] };
}

function worstBook(): { items: Item[]; listings: Listing[] } {
  const japanese = item({
    id: "example-worst-japanese",
    card: {
      id: "example-worst-japanese-card",
      name: "リザードンex SAR スペシャルアートレア",
      setName: "SwordShieldBrilliantStarsTrainerGallery",
      number: "TG20/TG30",
      imageUrl: BROKEN_IMAGE,
      language: "JP",
    },
    photos: [photo("example-worst-japanese-photo", BROKEN_IMAGE)],
    grade: "RAW",
    quantity: 1,
    costBasis: 9_999_999,
    acquiredFrom: "カードショップ秋葉原",
    location: "Binder shelf C / top loader case 14",
    condition: "NM with a tiny whitening speck on the back left corner",
    status: "IN_STOCK",
    createdAt: NOW,
    acquiredAt: LONG_AGO,
  });

  const accented = item({
    id: "example-worst-accented",
    card: {
      id: "example-worst-accented-card",
      name: "Flabébé",
      setName: "Pokémon XY",
      number: "62/146",
      imageUrl: null,
      language: "EN",
    },
    grade: "RAW",
    quantity: 1,
    costBasis: 1,
    condition: null,
    location: null,
    acquiredFrom: null,
    status: "IN_STOCK",
    createdAt: minutesBefore(NOW, 2),
  });

  const literal = item({
    id: "example-worst-literal",
    card: {
      id: "example-worst-literal-card",
      name: "<script>alert(1)</script> &amp; **Pikachu**",
      setName: "Line one\nLine two",
      number: null,
      imageUrl: null,
      language: "EN",
    },
    grade: "PSA_10",
    quantity: 1,
    costBasis: 0,
    condition: "   ",
    graderCert: "00000000",
    status: "IN_STOCK",
    createdAt: minutesBefore(NOW, 1),
  });

  const short = item({
    id: "example-worst-mew",
    card: {
      id: "example-worst-mew-card",
      name: "Mew",
      setName: "Pokémon",
      number: "8",
      imageUrl: null,
      language: "EN",
    },
    grade: "RAW",
    quantity: 1_000,
    costBasis: 0,
    condition: "NM",
    location: "Box A",
    status: "RESERVED",
  });

  const vietnamese = item({
    id: "example-worst-diacritics",
    card: {
      id: "example-worst-diacritics-card",
      name: "Đặng Thị Ngọc Hân's Pikachu",
      setName: "Celebrations",
      number: "025/025",
      imageUrl: null,
      language: "EN",
    },
    grade: "CGC_10",
    quantity: 1,
    costBasis: 12_50,
    condition: "NM",
    status: "IN_STOCK",
  });

  const live = item({
    id: "example-worst-live",
    card: {
      id: "example-worst-live-card",
      name: "Charizard ex Special Illustration Rare Obsidian Flames",
      setName: "Obsidian Flames",
      number: "223/197",
      imageUrl: null,
      language: "EN",
    },
    photos: [photo("example-worst-live-photo", "/brand/v2/app-icon-192-v1.png")],
    grade: "RAW",
    quantity: 1,
    costBasis: 18_000,
    condition: "NM",
    location: "To list",
    status: "LISTED",
    createdAt: minutesBefore(NOW, 3),
  });
  const liveListing = listing({
    id: "example-worst-live-listing",
    itemId: live.id,
    title: "Charizard ex SIR 223/197 Obsidian Flames NM Pokemon TCG English Raw",
    state: "ACTIVE",
    suggestedPrice: 9_999_999,
    listPrice: 9_999_999,
    externalRef: "example-ebay-item",
    externalUrl: "https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved",
    listedAt: YESTERDAY,
  }, live);

  const draft = item({
    id: "example-worst-draft",
    card: {
      id: "example-worst-draft-card",
      name: "こくばバドレックスVMAX",
      setName: "シャイニートレジャーex",
      number: "086/190",
      imageUrl: null,
      language: "JP",
    },
    grade: "BGS_10",
    quantity: 2,
    costBasis: 99,
    condition: "NM",
    graderCert: "0012345678",
    status: "IN_STOCK",
    createdAt: minutesBefore(NOW, 4),
  });
  const draftListing = listing({
    id: "example-worst-draft-listing",
    itemId: draft.id,
    title: "こくばバドレックスVMAX 086/190 シャイニートレジャーex BGS 10",
    state: "DRAFT",
    suggestedPrice: 99,
    listPrice: 99,
  }, draft);

  const ended = item({
    id: "example-worst-sold",
    card: {
      id: "example-worst-sold-card",
      name: "Pikachu",
      setName: "Base",
      number: "58/102",
      imageUrl: null,
    },
    grade: "RAW",
    quantity: 0,
    costBasis: 500,
    condition: "LP",
    status: "SOLD",
  });

  const items = [japanese, accented, literal, short, vietnamese, live, draft, ended];
  const listings = [withItem(liveListing, live), withItem(draftListing, draft)];
  return { items, listings };
}

function oneBook(): { items: Item[]; listings: Listing[] } {
  const mew = item({
    id: "example-one-mew",
    card: {
      id: "example-one-mew-card",
      name: "Mew",
      setName: "Pokémon",
      number: "8",
      imageUrl: null,
      language: "EN",
    },
    grade: "RAW",
    quantity: 1,
    costBasis: 1,
    condition: "NM",
    status: "IN_STOCK",
  });
  return { items: [mew], listings: [] };
}

function thousandBook(): { items: Item[]; listings: Listing[] } {
  const items: Item[] = [];
  for (let index = 1; index <= 1_000; index += 1) {
    const varied = index === 1
      ? "リザードンex SAR スペシャルアートレア"
      : index === 2
        ? "Flabébé"
        : index === 3
          ? "Mew"
          : `Pikachu ${index}`;
    items.push(item({
      id: `example-thousand-${index}`,
      card: {
        id: `example-thousand-card-${index}`,
        name: varied,
        setName: index === 1 ? "SwordShieldBrilliantStarsTrainerGallery" : "Pokémon",
        number: String(index),
        imageUrl: null,
        language: index === 1 ? "JP" : "EN",
      },
      quantity: index === 3 ? 1 : 1,
      costBasis: index === 1 ? 9_999_999 : index === 2 ? 1 : 2500,
      condition: index % 5 === 0 ? null : "NM",
      status: "IN_STOCK",
      createdAt: new Date(Date.parse(NOW) - index * 60_000).toISOString(),
    }));
  }
  return { items, listings: [] };
}

function withItem(row: Listing, owner: Item): Listing {
  const { listings: _listings, ...rest } = owner;
  return { ...row, item: { ...rest, listings: [] } };
}

export function bookFor(mode: WorstCaseMode): { items: Item[]; listings: Listing[] } {
  if (mode === "empty" || mode === "error") return { items: [], listings: [] };
  if (mode === "demo") return demoBook();
  if (mode === "one") return oneBook();
  if (mode === "thousand") return thousandBook();
  return worstBook();
}

export function dashboardFor(mode: WorstCaseMode, items: Item[], listings: Listing[]) {
  const active = items.filter((row) => row.status !== "SOLD");
  const activeCost = active.reduce((sum, row) => sum + row.costBasis * Math.max(row.quantity, 0), 0);
  const huge = mode === "worst";
  return {
    metrics: {
      stockCount: active.length,
      listedCount: listings.filter((row) => row.state === "ACTIVE").length,
      soldCount: huge ? 1 : 0,
      reservedCount: items.filter((row) => row.status === "RESERVED").length,
      activeCostPence: huge ? 9_999_999 : activeCost,
      soldCostPence: huge ? 500 : 0,
      realizedRevenuePence: huge ? 9_999_999 : 0,
      realizedFeesPence: huge ? 1 : 0,
      realizedPostagePence: 0,
      realizedProfitPence: huge ? 9_999_999 : 0,
      operatingExpensePence: huge ? 1 : 0,
      netProfitPence: huge ? -9_999_999 : 0,
      provisionalSaleCount: huge ? 1 : 0,
      cashInPence: huge ? 9_999_999 : 0,
      cashOutPence: huge ? 9_999_999 : activeCost,
      cashNetPence: huge ? -9_999_999 : -activeCost,
      cashRecoveryPct: huge ? 142 : 0,
      realizedMarginPct: huge ? -3 : null,
      sellThroughPct: huge ? 142 : mode === "one" ? 0 : 0,
      averageAgeDays: huge ? 1_284 : 0,
      agedStockCount: huge ? 1 : 0,
      channelBreakdown: [],
      bestSale: huge ? saleSummary() : null,
      worstSale: huge ? { ...saleSummary(), profitPence: -4_250, name: "Mew" } : null,
    },
    listingsByState: {
      DRAFT: listings.filter((row) => row.state === "DRAFT").length,
      ACTIVE: listings.filter((row) => row.state === "ACTIVE").length,
      SOLD: listings.filter((row) => row.state === "SOLD").length,
      ENDED: listings.filter((row) => row.state === "ENDED").length,
    },
    staleStock: huge ? [{ id: "example-worst-japanese", name: "リザードンex SAR スペシャルアートレア", grade: "RAW", status: "IN_STOCK", createdAt: LONG_AGO }] : [],
    recentSales: huge ? [{ ...saleSummary(), soldAt: YESTERDAY }] : [],
    salesToReconcile: huge ? [{ ...saleSummary(), costsEstimated: true, cardName: saleSummary().name }] : [],
    salesToReconcileCount: huge ? 1 : 0,
    recentExpenses: [],
    monthlyPnl: [],
  };
}

function saleSummary() {
  return {
    id: "example-worst-sale",
    itemId: "example-worst-sold",
    name: "Charizard ex Special Illustration Rare Obsidian Flames",
    grade: "RAW",
    channel: "EBAY" as const,
    salePricePence: 9_999_999,
    feesPence: 1,
    postagePence: 0,
    costBasisPence: 500,
    profitPence: 9_999_999,
    marginPct: 142,
    soldAt: YESTERDAY,
    costsEstimated: true,
  };
}

export function worstCompEvents() {
  const card = {
    id: "example-worst-comp-card",
    name: "リザードンex SAR スペシャルアートレア",
    setName: "SwordShieldBrilliantStarsTrainerGallery",
    setCode: "swsh9",
    number: "TG20/TG30",
    imageUrl: BROKEN_IMAGE,
    displayImageUrl: null,
    game: "POKEMON",
    language: "JP",
  };
  const asOf = NOW;
  const headline = {
    source: "checked-comps",
    card,
    grade: "RAW",
    currency: "GBP",
    medianPence: 9_999_999,
    meanPence: 9_999_999,
    lowPence: 1,
    highPence: 9_999_999,
    sampleSize: 40,
    windowDays: 90,
    trendPct: 142,
    outliersRemoved: 1,
    asOf,
  };
  const receiptCore = {
    headline,
    all: [headline],
    sourcesDisagree: false,
    reconciliation: {
      headlinePence: 9_999_999,
      confidence: "high",
      manualCheck: false,
      reasons: [],
      chosenSource: "checked-comps",
      trendPct: 142,
    },
  };
  const receipt = {
    ...receiptCore,
    catalog: card,
    alternatives: [],
    ambiguous: false,
    psaCert: null,
    cardImage: { imageUrl: BROKEN_IMAGE, source: "catalog", listingSafe: false },
    askEvidence: {
      source: "ebay-browse",
      marketplaceId: "EBAY_GB",
      query: card.name,
      asOf,
      count: 0,
      listings: [],
      lowestPence: null,
      undercutPence: null,
      skipped: true,
    },
    identityConfidence: {
      level: "high",
      score: 96,
      autoSelectable: true,
      reasons: ["Example data identity"],
      conflicts: [],
    },
  };
  const base = { version: 1, lookupId: "example-worst-lookup", emittedAt: asOf };
  return [
    { ...base, sequence: 1, type: "catalog", requested: card, identity: card, grade: "RAW", catalog: card, ambiguity: false, sources: [{ name: "checked-comps", live: true }] },
    { ...base, sequence: 2, type: "source", source: { name: "checked-comps", live: true }, status: "priced", latencyMs: 18, completed: 1, total: 1, result: headline, receipt: receiptCore },
    { ...base, sequence: 3, type: "verdict", phase: "quorum", ambiguity: false, pricedSourceCount: 1, receipt: receiptCore },
    { ...base, sequence: 4, type: "receipt", latencyMs: 31, receipt },
  ];
}

export const WORST_COMP_QUERY = "リザードンex SAR スペシャルアートレア SwordShieldBrilliantStarsTrainerGallery TG20/TG30";
