"use client";

import { type FormEvent, useMemo } from "react";
import { buildProfitTrend, type ProfitTrendPoint } from "@/lib/dealer/metrics";
import type { RepriceRecommendation } from "@/lib/alerts/repricing";
import type { WatchHit } from "@/lib/alerts/watchlist";
import { formatGbp as gbp } from "@/lib/format/money";
import { CardImage, EmptyState, Metric, MoneyInput } from "./UiBits";

type Channel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
type ExpenseCategory = "SUPPLIES" | "POSTAGE" | "GRADING" | "TABLE_FEE" | "TRAVEL" | "PLATFORM" | "OTHER";

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
    displayImageUrl?: string | null;
  };
  alerts?: Array<{ id: string; message: string; pence: number | null; firedAt: string; delivered: boolean }>;
};

type PortfolioPoint = {
  date: string;
  marketValuePence: number;
  snapshotCount: number;
};

type PortfolioHistory = {
  points: PortfolioPoint[];
  latest: PortfolioPoint | null;
  changePence: number | null;
  changePct: number | null;
  checkedAt?: string;
};

type Dashboard = any;
type InventoryItem = any;
type SaleSummary = any;
type ExpensePreset = { category: ExpenseCategory; description: string; amount?: string; channel?: Channel };

const channels: Channel[] = ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"];
const expenseCategories: ExpenseCategory[] = ["SUPPLIES", "POSTAGE", "GRADING", "TABLE_FEE", "TRAVEL", "PLATFORM", "OTHER"];
const expensePresets: ExpensePreset[] = [
  { category: "POSTAGE", description: "Postage supplies", amount: "5.00" },
  { category: "SUPPLIES", description: "Sleeves / toploaders", amount: "10.00" },
  { category: "TABLE_FEE", description: "Card fair table", amount: "15.00", channel: "IN_PERSON" },
  { category: "GRADING", description: "Grading submission", amount: "19.99" },
  { category: "TRAVEL", description: "Travel to buy stock", amount: "5.00", channel: "IN_PERSON" },
];

export function ProfitTab({
  dashboard,
  dashboardLoading,
  inventory,
  expenses,
  portfolio,
  watches,
  watchHits,
  watchEdits,
  repriceRecommendations,
  expensePanelRef,
  pnlWatchPanelRef,
  expenseDescriptionRef,
  expenseDescription,
  setExpenseDescription,
  expenseAmount,
  setExpenseAmount,
  expenseSpentAt,
  setExpenseSpentAt,
  expenseCategory,
  setExpenseCategory,
  expenseChannel,
  setExpenseChannel,
  busy,
  watchMessage,
  watchCheckedAt,
  watchDiscordReady,
  repriceMessage,
  repriceCheckedAt,
  discordReady,
  applyExpensePreset,
  addExpense,
  deleteExpense,
  takePortfolioSnapshot,
  checkWatches,
  setWatchEdits,
  saveWatchTarget,
  patchWatch,
  requestDeleteWatch,
  checkReprices,
  applyReprice,
  requestUndoSale,
}: {
  dashboard: Dashboard | null;
  dashboardLoading: boolean;
  inventory: InventoryItem[];
  expenses: ExpenseRecord[];
  portfolio: PortfolioHistory | null;
  watches: WatchRecord[];
  watchHits: WatchHit[];
  watchEdits: Record<string, string>;
  repriceRecommendations: RepriceRecommendation[];
  expensePanelRef: any;
  pnlWatchPanelRef: any;
  expenseDescriptionRef: any;
  expenseDescription: string;
  setExpenseDescription: (value: string) => void;
  expenseAmount: string;
  setExpenseAmount: (value: string) => void;
  expenseSpentAt: string;
  setExpenseSpentAt: (value: string) => void;
  expenseCategory: ExpenseCategory;
  setExpenseCategory: (value: ExpenseCategory) => void;
  expenseChannel: Channel | "";
  setExpenseChannel: (value: Channel | "") => void;
  busy: string | null;
  watchMessage: string | null;
  watchCheckedAt: string | null;
  watchDiscordReady: boolean | null;
  repriceMessage: string | null;
  repriceCheckedAt: string | null;
  discordReady: boolean | null;
  applyExpensePreset: (preset: ExpensePreset) => void;
  addExpense: (event: FormEvent<HTMLFormElement>) => void;
  deleteExpense: (expense: ExpenseRecord) => void;
  takePortfolioSnapshot: () => void;
  checkWatches: () => void;
  setWatchEdits: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  saveWatchTarget: (watch: WatchRecord) => void;
  patchWatch: (watch: WatchRecord, patch: Partial<Pick<WatchRecord, "active">>, message: string) => void;
  requestDeleteWatch: (watch: WatchRecord) => void;
  checkReprices: () => void;
  applyReprice: (recommendation: RepriceRecommendation) => void;
  requestUndoSale: (sale: SaleSummary) => void;
}) {
  const noBookedSales = !dashboardLoading && (dashboard?.metrics.soldCount ?? 0) === 0;
  const netProfitPence = dashboard?.metrics.netProfitPence ?? dashboard?.metrics.realizedProfitPence ?? 0;
  const netProfitTone = netProfitPence >= 0 ? "good" : "warn";
  const cashNetPence = dashboard?.metrics.cashNetPence ?? 0;
  const cashNetTone = cashNetPence >= 0 ? "good" : "warn";
  const profitTrend = useMemo(() => buildProfitTrend(dashboard?.recentSales ?? []), [dashboard?.recentSales]);

  return (
    <section className="workspace pnl-workspace">
      <header className="workspace-masthead profit-masthead">
        <div className="workspace-masthead-copy">
          <span className="workspace-kicker">Dealer ledger</span>
          <h2>Know what the collection is earning.</h2>
          <p>Sales, costs, cash recovery and stock value in one accountable view.</p>
        </div>
        <div className="export-actions" aria-label="Books export">
          <a className="export-link" href="/api/export/books" download>
            Sales CSV
          </a>
          <a className="export-link" href="/api/export/expenses" download>
            Costs CSV
          </a>
        </div>
      </header>

      <section className={`pnl-summary profit-overview ${noBookedSales ? "empty" : ""}`}>
        <div className="profit-overview-lead">
          <span className="profit-overview-label">Net P&amp;L</span>
          <strong className={netProfitTone}>{gbp(netProfitPence)}</strong>
          <div className="profit-equation" aria-label="Net profit calculation">
            <span>
              <small>Gross profit</small>
              {gbp(dashboard?.metrics.realizedProfitPence ?? 0)}
            </span>
            <i aria-hidden="true">−</i>
            <span>
              <small>Operating costs</small>
              {gbp(dashboard?.metrics.operatingExpensePence ?? 0)}
            </span>
            <i aria-hidden="true">=</i>
            <span className={netProfitTone}>
              <small>Net</small>
              {gbp(netProfitPence)}
            </span>
          </div>
        </div>
        <div className="profit-overview-trend">
          {noBookedSales ? (
            <div className="pnl-empty-note">
              <strong>Nothing booked yet</strong>
              <span>Mark a stocked card sold from Stock, then add any setup costs here so net profit stays honest.</span>
            </div>
          ) : profitTrend.length > 0 ? (
            <ProfitSparkline points={profitTrend} />
          ) : null}
        </div>
        <div className="detail-grid profit-metric-strip">
          <Metric label="Revenue" value={gbp(dashboard?.metrics.realizedRevenuePence ?? 0)} loading={dashboardLoading} />
          <Metric label="Profit" value={gbp(dashboard?.metrics.realizedProfitPence ?? 0)} tone="good" loading={dashboardLoading} />
          <Metric label="Costs" value={gbp(dashboard?.metrics.operatingExpensePence ?? 0)} tone="warn" loading={dashboardLoading} />
          <Metric label="Net" value={gbp(netProfitPence)} tone={netProfitTone} loading={dashboardLoading} />
          <Metric
            label="Margin"
            value={dashboard?.metrics.realizedMarginPct == null ? "n/a" : `${dashboard.metrics.realizedMarginPct}%`}
            loading={dashboardLoading}
          />
          <Metric label="Sell-through" value={`${dashboard?.metrics.sellThroughPct ?? 0}%`} loading={dashboardLoading} />
        </div>
      </section>

      <div className="profit-ledger-layout">
        <div className="profit-ledger-main">
          {dashboard?.monthlyPnl?.length ? (
            <section className="panel monthly-pnl-panel profit-ledger-section">
              <div className="panel-heading">
                <div>
                  <h2>Monthly P&amp;L</h2>
                  <span className="muted">A period-by-period record after cost basis, fees and operating costs</span>
                </div>
              </div>
              <div className="channel-list">
                {dashboard.monthlyPnl.map((row: any) => (
                  <article className={`channel-row ${row.netProfitPence >= 0 ? "good" : "warn"}`} key={row.month}>
                    <div>
                      <strong>{formatMonth(row.month)}</strong>
                      <span>
                        {row.saleCount} sale{row.saleCount === 1 ? "" : "s"} · revenue {gbp(row.revenuePence)}
                      </span>
                    </div>
                    <div>
                      <strong>{gbp(row.netProfitPence)}</strong>
                      <span>gross {gbp(row.profitPence)}</span>
                    </div>
                    <small>
                      cost {gbp(row.costBasisPence)} · fees {gbp(row.feesPence)} · postage {gbp(row.postagePence)} · costs{" "}
                      {gbp(row.operatingExpensePence)}
                    </small>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="panel channel-panel profit-ledger-section">
            <div className="panel-heading">
              <div>
                <h2>Channel performance</h2>
                <span className="muted">See where sales work after fees and postage</span>
              </div>
              <span className="pill">{dashboard?.metrics.channelBreakdown.length ?? 0} active</span>
            </div>
            {dashboard?.metrics.channelBreakdown.length ? (
              <div className="channel-list">
                {dashboard.metrics.channelBreakdown.map((row: any) => (
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
              <EmptyState art="sales" text="No channel data yet. Mark a sale from Stock and this will show which channel is working." />
            )}
          </section>

          <section className="panel profit-ledger-section recent-sales-panel">
            <div className="panel-heading">
              <div>
                <h2>Recent sales</h2>
                <span className="muted">The latest booked profit entries</span>
              </div>
            </div>
            {dashboard?.recentSales.length ? (
              dashboard.recentSales.map((sale: SaleSummary) => (
                <article className="mini-row sale-mini-row" key={sale.id}>
                  <div>
                    <strong>
                      {sale.name} {sale.grade.replace(/_/g, " ")}
                    </strong>
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
                      {busy === `sale-${sale.id}` ? "Undoing…" : "Undo"}
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <EmptyState art="sales" text="No sales booked yet. Mark an item sold from Stock." />
            )}
          </section>
        </div>

        <aside className="profit-ledger-sidebar" aria-label="Cash and stock position">
          <section className="panel cash-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">Cash position</span>
                <h2>Money recovered</h2>
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

          <section className="panel portfolio-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">Collection capital</span>
                <h2>Stock value</h2>
              </div>
              <span className="muted">{portfolio?.latest ? `${portfolio.latest.snapshotCount} priced` : "No snapshot"}</span>
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
              {busy === "snapshot" ? "Valuing stock…" : "Snapshot stock value"}
            </button>
            {portfolio?.checkedAt && <p className="hint">Last valued {ageLabel(portfolio.checkedAt)}.</p>}
          </section>
        </aside>
      </div>

      <section className="profit-operations" aria-labelledby="profit-operations-title">
        <header className="profit-operations-heading">
          <div>
            <span className="workspace-kicker">Ledger controls</span>
            <h2 id="profit-operations-title">Keep the numbers honest</h2>
          </div>
          <p>Book costs, monitor buying targets and move ageing stock from one operational desk.</p>
        </header>

        <div className="profit-operations-grid">
          <section className="panel expense-panel" ref={expensePanelRef}>
            <div className="panel-heading">
              <div>
                <h2>Operating costs</h2>
                <span className="muted">{expenses.length} saved</span>
              </div>
              <strong>{gbp(dashboard?.metrics.operatingExpensePence ?? 0)}</strong>
            </div>
            <form className="expense-form" onSubmit={addExpense}>
              <div className="preset-row expense-presets" aria-label="Cost presets">
                {expensePresets.map((preset) => (
                  <button key={`${preset.category}-${preset.description}`} type="button" onClick={() => applyExpensePreset(preset)}>
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
                  name="expense-description"
                  placeholder="Toploaders, table fee, grading…"
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
                      <option key={category} value={category}>
                        {expenseCategoryLabel(category)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Channel
                  <select value={expenseChannel} onChange={(event) => setExpenseChannel(event.target.value as Channel | "")}>
                    <option value="">general</option>
                    {channels.map((channel) => (
                      <option key={channel} value={channel}>
                        {channelLabel(channel)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="primary-action" type="submit" disabled={busy === "expense-create"}>
                {busy === "expense-create" ? "Saving…" : "Add cost"}
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

          <section className="panel watch-panel" ref={pnlWatchPanelRef}>
            <div className="panel-heading">
              <div>
                <h2>Buy watches</h2>
                <span className="muted">Targets ready for the next deal</span>
              </div>
              <span className="pill">{watches.filter((watch) => watch.active).length} active</span>
            </div>
            <button className="primary-action" type="button" onClick={checkWatches} disabled={busy === "watch-check"}>
              {busy === "watch-check" ? "Checking…" : "Check buy targets"}
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
                {watches.length === 0 && <EmptyState art="watches" text="No buy watches yet." />}
              </div>
            )}
          </section>

          <section className="panel stock-health-panel">
            <div className="panel-heading">
              <div>
                <h2>Stock health</h2>
                <span className="muted">Repricing signals for ageing cards</span>
              </div>
              <span className="pill">{dashboard?.metrics.averageAgeDays ?? 0}d avg age</span>
            </div>
            <div className="detail-grid">
              <Metric label="Active cost" value={gbp(dashboard?.metrics.activeCostPence ?? 0)} />
              <Metric label="45d+ stock" value={String(dashboard?.metrics.agedStockCount ?? 0)} />
            </div>
            <button className="primary-action" type="button" onClick={checkReprices} disabled={busy === "reprice"}>
              {busy === "reprice" ? "Checking…" : "Check reprices"}
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
                {repriceRecommendations.map((recommendation) => {
                  const listing = inventory.find((row) => row.id === recommendation.itemId)?.listings[0];
                  return (
                    <RepriceActionRow
                      key={recommendation.itemId}
                      recommendation={recommendation}
                      busy={busy === `listing-${listing?.id}`}
                      canApply={Boolean(listing)}
                      onApply={applyReprice}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </section>
    </section>
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
          {gbp(recommendation.currentPricePence)} -&gt; {gbp(recommendation.suggestedPricePence)}
        </span>
        <button type="button" onClick={() => onApply(recommendation)} disabled={busy || !canApply}>
          {busy ? "Saving…" : "Apply"}
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
      <CardImage src={watch.card.imageUrl ?? watch.card.displayImageUrl ?? null} className="watch-card-art" fallbackClassName="watch-card-art blank" alt="" />
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
        <span>
          {hit.grade.replace(/_/g, " ")} · {hit.sampleSize}/{hit.windowDays}d
        </span>
      </div>
      <div>
        <strong>{gbp(hit.marketPence)}</strong>
        <span>target {gbp(hit.targetPence)}</span>
      </div>
    </article>
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

  if (points.length < 2) {
    return (
      <div className="profit-sparkline">
        <div>
          <span>Profit trend</span>
          <strong>{latest ? gbp(latest.cumulativeProfitPence) : "n/a"}</strong>
          <small>{latest ? "Trend starts with your next booked sale." : "Book a sale to start the trend."}</small>
        </div>
      </div>
    );
  }

  return (
    <div className="profit-sparkline">
      <div>
        <span>Profit trend</span>
        <strong>{latest ? gbp(latest.cumulativeProfitPence) : "n/a"}</strong>
        {first && latest && (
          <small>
            {shortDate(first.date)} to {shortDate(latest.date)}
          </small>
        )}
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

function formatMonth(value: string): string {
  const date = new Date(`${value}-01T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function penceToPounds(pence: number | null | undefined): string {
  if (pence == null || !Number.isFinite(pence)) return "";
  return (pence / 100).toFixed(2);
}
