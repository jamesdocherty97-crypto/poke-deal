import { realizedProfit } from "../comps/pricing.js";

export type CsvCell = string | number | boolean | null | undefined | Date;

export type ListingExportRecord = {
  id: string;
  channel: string;
  state: string;
  title: string | null;
  suggestedPrice: number | null;
  listPrice: number | null;
  externalRef: string | null;
  externalUrl: string | null;
  createdAt: Date;
  listedAt: Date | null;
  endedAt: Date | null;
  item: {
    id: string;
    grade: string;
    quantity: number;
    costBasis: number;
    acquiredFrom: string | null;
    acquiredAt: Date;
    location: string | null;
    status: string;
    card: {
      name: string;
      setName: string;
      number: string | null;
      rarity: string | null;
      tcgApiId: string | null;
    };
  };
};

export type BookSaleExportRecord = {
  id: string;
  channel: string;
  salePrice: number;
  fees: number;
  postage: number;
  soldAt: Date;
  item: {
    id: string;
    grade: string;
    quantity: number;
    costBasis: number;
    acquiredFrom: string | null;
    acquiredAt: Date;
    card: {
      name: string;
      setName: string;
      number: string | null;
      rarity: string | null;
      tcgApiId: string | null;
    };
  };
};

export type ExpenseExportRecord = {
  id: string;
  category: string;
  description: string;
  amount: number;
  spentAt: Date;
  channel: string | null;
  source: string | null;
  notes: string | null;
  createdAt: Date;
};

type CsvRow = Record<string, CsvCell>;

const LISTING_COLUMNS = [
  "channel",
  "state",
  "title",
  "card_name",
  "set_name",
  "number",
  "grade",
  "quantity",
  "currency",
  "list_price_gbp",
  "suggested_price_gbp",
  "cost_basis_gbp",
  "inventory_status",
  "location",
  "external_url",
  "external_ref",
  "created_at",
  "listed_at",
  "ended_at",
  "item_id",
  "listing_id",
  "tcg_api_id",
] as const;

const BOOK_COLUMNS = [
  "sold_at",
  "channel",
  "card_name",
  "set_name",
  "number",
  "grade",
  "quantity",
  "currency",
  "sale_price_gbp",
  "fees_gbp",
  "postage_gbp",
  "cost_basis_gbp",
  "profit_gbp",
  "margin_pct",
  "acquired_at",
  "acquired_from",
  "item_id",
  "sale_id",
  "tcg_api_id",
] as const;

const EXPENSE_COLUMNS = [
  "spent_at",
  "category",
  "description",
  "currency",
  "amount_gbp",
  "channel",
  "source",
  "notes",
  "created_at",
  "expense_id",
] as const;

export function listingsToCsv(listings: ListingExportRecord[]): string {
  return toCsv(
    LISTING_COLUMNS,
    listings.map((listing) => {
      const item = listing.item;
      const card = item.card;
      return {
        channel: listing.channel,
        state: listing.state,
        title: listing.title ?? fallbackListingTitle(card.name, card.number, item.grade),
        card_name: card.name,
        set_name: card.setName,
        number: card.number,
        grade: item.grade,
        quantity: item.quantity,
        currency: "GBP",
        list_price_gbp: formatGbpDecimal(listing.listPrice),
        suggested_price_gbp: formatGbpDecimal(listing.suggestedPrice),
        cost_basis_gbp: formatGbpDecimal(item.costBasis),
        inventory_status: item.status,
        location: item.location,
        external_url: listing.externalUrl,
        external_ref: listing.externalRef,
        created_at: isoDate(listing.createdAt),
        listed_at: isoDate(listing.listedAt),
        ended_at: isoDate(listing.endedAt),
        item_id: item.id,
        listing_id: listing.id,
        tcg_api_id: card.tcgApiId,
      };
    }),
  );
}

export function booksToCsv(sales: BookSaleExportRecord[]): string {
  return toCsv(
    BOOK_COLUMNS,
    sales.map((sale) => {
      const item = sale.item;
      const card = item.card;
      const profit = realizedProfit({
        salePrice: sale.salePrice,
        fees: sale.fees,
        postage: sale.postage,
        costBasis: item.costBasis,
      });
      const marginPct = sale.salePrice > 0 ? Math.round((profit / sale.salePrice) * 1000) / 10 : null;

      return {
        sold_at: isoDate(sale.soldAt),
        channel: sale.channel,
        card_name: card.name,
        set_name: card.setName,
        number: card.number,
        grade: item.grade,
        quantity: 1,
        currency: "GBP",
        sale_price_gbp: formatGbpDecimal(sale.salePrice),
        fees_gbp: formatGbpDecimal(sale.fees),
        postage_gbp: formatGbpDecimal(sale.postage),
        cost_basis_gbp: formatGbpDecimal(item.costBasis),
        profit_gbp: formatGbpDecimal(profit),
        margin_pct: marginPct,
        acquired_at: isoDate(item.acquiredAt),
        acquired_from: item.acquiredFrom,
        item_id: item.id,
        sale_id: sale.id,
        tcg_api_id: card.tcgApiId,
      };
    }),
  );
}

export function expensesToCsv(expenses: ExpenseExportRecord[]): string {
  return toCsv(
    EXPENSE_COLUMNS,
    expenses.map((expense) => ({
      spent_at: isoDate(expense.spentAt),
      category: expense.category,
      description: expense.description,
      currency: "GBP",
      amount_gbp: formatGbpDecimal(expense.amount),
      channel: expense.channel,
      source: expense.source,
      notes: expense.notes,
      created_at: isoDate(expense.createdAt),
      expense_id: expense.id,
    })),
  );
}

export function toCsv(columns: readonly string[], rows: CsvRow[]): string {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(","));
  return [header, ...body].join("\n") + "\n";
}

export function escapeCsvCell(value: CsvCell): string {
  if (value == null) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function formatGbpDecimal(pence: number | null | undefined): string {
  return pence == null ? "" : (pence / 100).toFixed(2);
}

function isoDate(value: Date | null | undefined): string {
  return value ? value.toISOString() : "";
}

function fallbackListingTitle(cardName: string, number: string | null, grade: string): string {
  return [cardName, number, grade === "RAW" ? "" : grade.replace(/_/g, " ")]
    .filter(Boolean)
    .join(" ");
}
