export type InventorySort = "newest" | "oldest" | "highest-cost" | "lowest-cost" | "name" | "grade";
export type ListingSort = "newest" | "oldest" | "highest-price" | "lowest-price" | "channel" | "state";
export type ListingStateFilter = "ALL" | "DRAFT" | "ACTIVE" | "SOLD" | "ENDED";

export interface InventoryTableItem {
  card: {
    name: string;
    setName: string;
    number: string | null;
  };
  grade: string;
  costBasis: number;
  status: string;
  createdAt: string;
  acquiredFrom?: string | null;
  location?: string | null;
}

export interface ListingTableRow {
  channel: string;
  state: string;
  title: string | null;
  suggestedPrice: number | null;
  listPrice: number | null;
  createdAt: string;
  item?: {
    grade: string;
    card: {
      name: string;
      setName: string;
      number: string | null;
    };
  };
}

export function buildInventoryView<T extends InventoryTableItem>(
  rows: readonly T[],
  options: { query: string; sort: InventorySort },
): T[] {
  return sortInventoryRows(filterInventoryRows(rows, options.query), options.sort);
}

export function buildListingView<T extends ListingTableRow>(
  rows: readonly T[],
  options: { query: string; state: ListingStateFilter; sort: ListingSort },
): T[] {
  const normalizedState = options.state.toUpperCase();
  const stateFiltered =
    normalizedState === "ALL" ? rows : rows.filter((row) => row.state.toUpperCase() === normalizedState);
  return sortListingRows(filterListingRows(stateFiltered, options.query), options.sort);
}

export function gradeRank(grade: string): number {
  const normalized = grade.toUpperCase();
  if (normalized === "RAW") return 0;
  const match = normalized.match(/^(PSA|BGS|CGC)_(\d+)(?:_(\d+))?$/);
  if (!match) return 1;
  const companyRank = match[1] === "PSA" ? 30 : match[1] === "BGS" ? 20 : 10;
  const whole = Number(match[2] ?? 0);
  const decimal = Number(match[3] ?? 0) / 10;
  return companyRank + whole + decimal;
}

function filterInventoryRows<T extends InventoryTableItem>(rows: readonly T[], query: string): T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => terms.every((term) => inventoryHaystack(row).includes(term)));
}

function filterListingRows<T extends ListingTableRow>(rows: readonly T[], query: string): T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => terms.every((term) => listingHaystack(row).includes(term)));
}

function sortInventoryRows<T extends InventoryTableItem>(rows: T[], sort: InventorySort): T[] {
  return [...rows].sort((a, b) => {
    if (sort === "oldest") return byDateAsc(a.createdAt, b.createdAt);
    if (sort === "highest-cost") return b.costBasis - a.costBasis || byDateDesc(a.createdAt, b.createdAt);
    if (sort === "lowest-cost") return a.costBasis - b.costBasis || byDateDesc(a.createdAt, b.createdAt);
    if (sort === "name") return byText(a.card.name, b.card.name) || byDateDesc(a.createdAt, b.createdAt);
    if (sort === "grade") return gradeRank(b.grade) - gradeRank(a.grade) || byDateDesc(a.createdAt, b.createdAt);
    return byDateDesc(a.createdAt, b.createdAt);
  });
}

function sortListingRows<T extends ListingTableRow>(rows: T[], sort: ListingSort): T[] {
  return [...rows].sort((a, b) => {
    if (sort === "oldest") return byDateAsc(a.createdAt, b.createdAt);
    if (sort === "highest-price") return listingPrice(b) - listingPrice(a) || byDateDesc(a.createdAt, b.createdAt);
    if (sort === "lowest-price") return listingPrice(a) - listingPrice(b) || byDateDesc(a.createdAt, b.createdAt);
    if (sort === "channel") return byText(a.channel, b.channel) || byDateDesc(a.createdAt, b.createdAt);
    if (sort === "state") return byText(a.state, b.state) || byDateDesc(a.createdAt, b.createdAt);
    return byDateDesc(a.createdAt, b.createdAt);
  });
}

function inventoryHaystack(row: InventoryTableItem): string {
  return normalizeSearch(
    [
      row.card.name,
      row.card.setName,
      row.card.number,
      row.grade,
      row.status,
      row.acquiredFrom,
      row.location,
    ].join(" "),
  );
}

function listingHaystack(row: ListingTableRow): string {
  return normalizeSearch(
    [
      row.title,
      row.channel,
      row.state,
      row.item?.grade,
      row.item?.card.name,
      row.item?.card.setName,
      row.item?.card.number,
    ].join(" "),
  );
}

function searchTerms(query: string): string[] {
  return normalizeSearch(query).split(" ").filter(Boolean);
}

function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_#/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function listingPrice(row: ListingTableRow): number {
  return row.listPrice ?? row.suggestedPrice ?? 0;
}

function byDateDesc(left: string, right: string): number {
  return Date.parse(right) - Date.parse(left);
}

function byDateAsc(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

function byText(left: string, right: string): number {
  return left.localeCompare(right, "en-GB", { sensitivity: "base" });
}
