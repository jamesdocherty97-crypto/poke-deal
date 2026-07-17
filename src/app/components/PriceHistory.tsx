"use client";

import type { CardPriceHistory, CardPriceHistoryPreview } from "@/lib/comps/priceHistory";
import { formatGbp as gbp } from "@/lib/format/money";
import { CardImage, EmptyState } from "./UiBits";

export type HistoryPointKind = "market" | "cost" | "listing" | "sold";
export type HistoryPoint = { at: string; pence: number; kind: HistoryPointKind };

const KIND_ORDER: HistoryPointKind[] = ["market", "cost", "listing", "sold"];

export function buildPriceHistoryPoints(history: CardPriceHistory): HistoryPoint[] {
  const market = history.snapshots.length > 0
    ? history.snapshots.map((row) => ({ at: row.takenAt, pence: row.marketPence, kind: "market" as const }))
    : history.comps.map((row) => ({ at: row.asOf, pence: row.medianPence, kind: "market" as const }));
  return [
    ...market,
    ...history.inventory.map((row) => ({ at: row.acquiredAt, pence: row.costBasis, kind: "cost" as const })),
    ...history.listings.flatMap((row) => {
      const pence = row.listPrice ?? row.suggestedPrice;
      return pence == null ? [] : [{ at: row.createdAt, pence, kind: "listing" as const }];
    }),
    ...history.sales.map((row) => ({ at: row.soldAt, pence: row.salePrice, kind: "sold" as const })),
  ].filter((point) => Number.isFinite(point.pence) && point.pence >= 0);
}

export function plotHistoryPoints(points: HistoryPoint[], width = 320, height = 120): Array<HistoryPoint & { x: number; y: number }> {
  if (points.length === 0) return [];
  const times = points.map((point) => new Date(point.at).getTime()).filter(Number.isFinite);
  const values = points.map((point) => point.pence);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const timeRange = Math.max(1, maxTime - minTime);
  const valueRange = Math.max(1, maxValue - minValue);
  return points.map((point) => ({
    ...point,
    x: ((new Date(point.at).getTime() - minTime) / timeRange) * width,
    y: height - ((point.pence - minValue) / valueRange) * height,
  }));
}

export function StockHistorySparkline({
  history,
  preview,
}: {
  history: CardPriceHistory | null | undefined;
  preview?: CardPriceHistoryPreview | null;
}) {
  if (!history && !preview) return <span className="stock-sparkline empty" aria-label="Price history not loaded">History</span>;
  const market = history
    ? buildPriceHistoryPoints(history).filter((point) => point.kind === "market")
    : (preview?.market ?? []).map((point) => ({ at: point.takenAt, pence: point.marketPence, kind: "market" as const }));
  const points = plotHistoryPoints(market, 92, 28);
  if (points.length === 0) return <span className="stock-sparkline empty" aria-label="No market price history">No history</span>;
  const path = points.length === 1
    ? "0,14 92,14"
    : points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return (
    <span className="stock-sparkline" aria-label={`${points.length} market history points`}>
      <svg viewBox="0 0 92 28" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={path} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

export function PriceHistorySheet({
  history,
  loading,
  onClose,
}: {
  history: CardPriceHistory | null;
  loading: boolean;
  onClose: () => void;
}) {
  const points = history ? plotHistoryPoints(buildPriceHistoryPoints(history), 640, 240) : [];
  const byKind = new Map(KIND_ORDER.map((kind) => [kind, points.filter((point) => point.kind === kind)]));
  const values = points.map((point) => point.pence);
  const low = values.length > 0 ? Math.min(...values) : 0;
  const high = values.length > 0 ? Math.max(...values) : 0;

  return (
    <section className="sell-sheet price-history-sheet" role="dialog" aria-modal="true" aria-label="Card price history">
      <div className="sheet-drag-handle" aria-hidden="true" />
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Price history</span>
          <h2>{history?.card.name ?? (loading ? "Loading…" : "No history")}</h2>
          {history && <span className="muted">{history.card.setName}{history.card.number ? ` #${history.card.number}` : ""} · {history.grade.replace(/_/g, " ")}</span>}
        </div>
        <button className="ghost-button" type="button" onClick={onClose}>Close</button>
      </div>
      {loading ? (
        <div className="history-skeleton" aria-label="Loading price history"><span /><span /><span /></div>
      ) : history && points.length > 0 ? (
        <>
          <div className="history-card-heading">
            <CardImage src={history.card.displayImageUrl ?? history.card.imageUrl} className="mini-card-art" fallbackClassName="mini-card-art blank" alt="" />
            <div><span>Range</span><strong>{gbp(low)}–{gbp(high)}</strong><small>{shortDate(history.range.from)} to {shortDate(history.range.to)}</small></div>
          </div>
          {history.receipt && <PriceHistoryMetrics receipt={history.receipt} />}
          <div className="price-history-chart" aria-label="Market, cost, listing and sold price history">
            <svg viewBox="0 0 640 240" role="img" aria-label={`Prices from ${gbp(low)} to ${gbp(high)}`}>
              <line className="history-grid-line" x1="0" x2="640" y1="0" y2="0" />
              <line className="history-grid-line" x1="0" x2="640" y1="120" y2="120" />
              <line className="history-grid-line" x1="0" x2="640" y1="240" y2="240" />
              {KIND_ORDER.map((kind) => {
                const rows = byKind.get(kind) ?? [];
                const path = rows.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
                return rows.length > 1 ? <polyline key={kind} className={`history-line ${kind}`} points={path} fill="none" vectorEffect="non-scaling-stroke" /> : null;
              })}
              {points.filter((point) => point.kind !== "market").map((point, index) => (
                <circle key={`${point.kind}-${point.at}-${index}`} className={`history-dot ${point.kind}`} cx={point.x} cy={point.y} r="5" />
              ))}
            </svg>
          </div>
          <div className="history-legend">
            <span className="market">Market</span><span className="cost">Your cost</span><span className="listing">Listing</span><span className="sold">Sold</span>
          </div>
          <div className="history-latest-grid">
            {KIND_ORDER.map((kind) => {
              const latest = (byKind.get(kind) ?? []).at(-1);
              return <div className={`freshness-${latest ? historyFreshnessKind(latest.at) : "expired"}`} key={kind}><span>{legendLabel(kind)}</span><strong>{latest ? gbp(latest.pence) : "—"}</strong><small>{latest ? shortDate(latest.at) : "No data"}</small></div>;
            })}
          </div>
        </>
      ) : (
        <EmptyState art="search" text="No price snapshots for this card and grade yet. Run a fresh comp; cost, listing and sold overlays will appear as the card moves through the ledger." />
      )}
    </section>
  );
}

function PriceHistoryMetrics({ receipt }: { receipt: NonNullable<CardPriceHistory["receipt"]> }) {
  const { liquidity, volatility, trend30Days, trend90Days, sourceDisagreement } = receipt.metrics;
  return (
    <div className="history-metric-grid" aria-label="Price evidence quality">
      <div>
        <span>Sales velocity</span>
        <strong>{liquidity.status === "available" ? `${liquidity.salesPer30Days?.toFixed(1)} / 30d` : "Not enough data"}</strong>
        <small>{liquidity.status === "available"
          ? `${historyProviderLabel(liquidity.provider)}${liquidity.market ? ` ${liquidity.market}` : ""} · n=${liquidity.sampleSize}/${liquidity.windowDays}d · ${liquidity.ageDays ?? 0}d old`
          : metricReasonLabel(liquidity.reason)}</small>
      </div>
      <div>
        <span>Price volatility</span>
        <strong>{volatility.status === "available" ? `${volatility.madPct?.toFixed(1)}% MAD` : "Not enough data"}</strong>
        <small>{volatility.status === "available"
          ? `${historyProviderLabel(volatility.provider)}${volatility.market ? ` ${volatility.market}` : ""} · ${volatility.observationCount} observations`
          : metricReasonLabel(volatility.reason)}</small>
      </div>
      <div>
        <span>Market trend</span>
        <strong>{trend30Days.status === "available" ? signedPercent(trend30Days.changePct) : "Not enough data"}</strong>
        <small>{trend30Days.status === "available"
          ? `30d · ${historyProviderLabel(trend30Days.provider)} · 90d ${trend90Days.status === "available" ? signedPercent(trend90Days.changePct) : metricReasonLabel(trend90Days.reason)}`
          : metricReasonLabel(trend30Days.reason)}</small>
      </div>
      <div>
        <span>Provider agreement</span>
        <strong>{sourceDisagreement.status === "available" ? `${sourceDisagreement.spreadPct?.toFixed(1)}% spread` : "Not comparable"}</strong>
        <small>{sourceDisagreement.status === "available"
          ? `${sourceDisagreement.sourceCount} sources · ${gbp(sourceDisagreement.lowPence ?? 0)}–${gbp(sourceDisagreement.highPence ?? 0)} · ${sourceDisagreement.evidence.map((row) => historyProviderLabel(row.provider)).join(", ")}`
          : metricReasonLabel(sourceDisagreement.reason)}</small>
      </div>
    </div>
  );
}

function signedPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function historyProviderLabel(provider: string | null): string {
  if (!provider) return "Unknown source";
  if (provider === "pokemon-price-tracker") return "Price Tracker";
  if (provider === "ebay-marketplace-insights") return "eBay UK sold";
  if (provider === "owned-sales") return "Your sales";
  if (provider === "checked-comps") return "Checked comps";
  if (provider === "pokemon-tcg-market") return "Catalog market";
  if (provider === "poketrace") return "PokeTrace";
  return provider.replace(/-/g, " ");
}

function metricReasonLabel(reason: string | null): string {
  if (reason === "no-sold-evidence") return "No genuine sold evidence yet";
  if (reason === "stale-evidence") return "Evidence is stale — run a fresh comp";
  if (reason === "minimum-sample") return "Sample is too small for a trustworthy metric";
  if (reason === "minimum-observations") return "More observations are needed";
  if (reason === "minimum-span") return "More time is needed before measuring change";
  if (reason === "minimum-sources") return "Only one comparable source is available";
  if (reason === "invalid-window") return "Provider window is not comparable";
  return "Insufficient trustworthy evidence";
}

function legendLabel(kind: HistoryPointKind): string {
  if (kind === "cost") return "Your cost";
  if (kind === "listing") return "Listed";
  if (kind === "sold") return "Sold";
  return "Market";
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

function historyFreshnessKind(value: string): "recent" | "aging" | "stale" | "expired" {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "expired";
  const ageDays = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1_000));
  if (ageDays <= 30) return "recent";
  if (ageDays <= 90) return "aging";
  if (ageDays <= 180) return "stale";
  return "expired";
}
