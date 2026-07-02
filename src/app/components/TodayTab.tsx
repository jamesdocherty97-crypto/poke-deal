"use client";

import type { LaunchReadinessItem, LaunchReadinessTarget } from "@/lib/dealer/launchReadiness";
import type { LaunchPlanItem, LaunchPlanTarget, LaunchProgress } from "@/lib/dealer/launchPlan";
import type { OperatingSnapshotRow } from "@/lib/dealer/operatingSnapshot";
import type { TodayAction, TodayActionTarget } from "@/lib/dealer/today";
import { CardImage } from "./UiBits";

type TodaySystemSource = {
  id: string;
  label: string;
  role: string;
  status: "ready" | "public" | "fixture" | "missing" | "building" | "problem";
  required: boolean;
  setupHint?: string;
};

type TodayDashboard = {
  metrics: {
    stockCount: number;
    soldCount: number;
    operatingExpensePence: number;
  };
};

type TodayListingItem = {
  card: {
    name: string;
    number: string | null;
    imageUrl: string | null;
  };
  photos?: Array<{ url: string }>;
};

type TodayListing = {
  title?: string | null;
  channel: string;
  listPrice?: number | null;
  suggestedPrice?: number | null;
  item?: TodayListingItem | null;
};

type TodaySystemStatus = {
  summary: {
    livePrimaryComps: boolean;
    secondaryCrossCheck: boolean;
  };
};

export function TodayTab({
  launchProgress,
  primaryTodayAction,
  todayActions,
  onOpenTodayAction,
  onNewBuy,
  operatingSnapshot,
  onProfit,
  firstSaleListingTarget,
  activeListingCount,
  onActiveListings,
  onRecordSale,
  launchPlan,
  onOpenLaunchPlan,
  systemStatus,
  setupSources,
  launchReadiness,
  onOpenLaunchReadiness,
  dashboard,
  listingsLength,
  draftListingCount,
  activeWatchCount,
  onOpeningStockImport,
  onListingDesk,
  onInventory,
  onSalesDesk,
  onBuyWatchesPanel,
  onCostsPanel,
  busy,
  onTakePortfolioSnapshot,
  onCheckWatches,
  onCheckReprices,
}: {
  launchProgress: LaunchProgress;
  primaryTodayAction: TodayAction | null;
  todayActions: TodayAction[];
  onOpenTodayAction: (target: TodayActionTarget) => void;
  onNewBuy: () => void;
  operatingSnapshot: OperatingSnapshotRow[];
  onProfit: () => void;
  firstSaleListingTarget: TodayListing | null;
  activeListingCount: number;
  onActiveListings: () => void;
  onRecordSale: (listing: TodayListing) => void;
  launchPlan: LaunchPlanItem[];
  onOpenLaunchPlan: (target: LaunchPlanTarget) => void;
  systemStatus: TodaySystemStatus | null;
  setupSources: TodaySystemSource[];
  launchReadiness: LaunchReadinessItem[];
  onOpenLaunchReadiness: (target: LaunchReadinessTarget | undefined) => void;
  dashboard: TodayDashboard | null;
  listingsLength: number;
  draftListingCount: number;
  activeWatchCount: number;
  onOpeningStockImport: (options?: { example?: boolean }) => void;
  onListingDesk: () => void;
  onInventory: () => void;
  onSalesDesk: () => void;
  onBuyWatchesPanel: () => void;
  onCostsPanel: () => void;
  busy: string | null;
  onTakePortfolioSnapshot: () => void;
  onCheckWatches: () => void;
  onCheckReprices: () => void;
}) {
  const stockCount = dashboard?.metrics.stockCount ?? 0;
  const soldCount = dashboard?.metrics.soldCount ?? 0;
  const operatingExpensePence = dashboard?.metrics.operatingExpensePence ?? 0;
  const sellStock = activeListingCount > 0 ? onSalesDesk : onInventory;

  return (
    <section className="workspace today-workspace">
      <section className="panel today-panel">
        <div className="panel-heading">
          <div>
            <h2>Today</h2>
            <span className="muted">{launchProgress.label} · {launchProgress.nextLabel}</span>
          </div>
          <button className="ghost-button" type="button" onClick={onNewBuy}>
            New buy
          </button>
        </div>
        {primaryTodayAction && (
          <NextMoveCard action={primaryTodayAction} progress={launchProgress} onOpen={onOpenTodayAction} />
        )}
        <div className="today-action-list">
          {todayActions.map((action) => (
            <TodayActionButton key={action.id} action={action} onOpen={onOpenTodayAction} />
          ))}
        </div>
      </section>

      <section className="panel operating-snapshot-panel">
        <div className="panel-heading">
          <div>
            <h2>Operating snapshot</h2>
            <span className="muted">cash, stock and listing flow</span>
          </div>
          <button className="ghost-button" type="button" onClick={onProfit}>
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
            <button className="ghost-button" type="button" onClick={onActiveListings}>
              Active
            </button>
          </div>
          <div className="listing-desk-card">
            <CardImage
              src={inventoryDisplayImage(firstSaleListingTarget.item)}
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
            <button type="button" onClick={() => onRecordSale(firstSaleListingTarget)}>
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
          <button className="ghost-button" type="button" onClick={onProfit}>
            Books
          </button>
        </div>
        <div className="launch-plan-list">
          {launchPlan.map((item) => (
            <LaunchPlanRow key={item.id} item={item} onOpen={onOpenLaunchPlan} />
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
              <LaunchReadinessRow key={item.id} item={item} onOpen={onOpenLaunchReadiness} />
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
            done={stockCount > 0}
            title="Stock ledger"
            detail={`${stockCount} stocked`}
            action={stockCount > 0 ? "Buy" : "Import"}
            onClick={() => {
              if (stockCount > 0) {
                onNewBuy();
                return;
              }
              onOpeningStockImport({ example: true });
            }}
          />
          <SetupStep
            done={listingsLength > 0}
            title="Listing pipeline"
            detail={`${draftListingCount} draft / ${activeListingCount} active`}
            action="Listings"
            onClick={onListingDesk}
          />
          <SetupStep
            done={soldCount > 0}
            title="Booked sales"
            detail={`${soldCount} sold`}
            action={activeListingCount > 0 ? "Sell" : "Stock"}
            onClick={sellStock}
          />
          <SetupStep
            done={activeWatchCount > 0}
            title="Sourcing targets"
            detail={`${activeWatchCount} active`}
            action="Targets"
            onClick={onBuyWatchesPanel}
          />
          <SetupStep
            done={operatingExpensePence > 0}
            title="Cost tracker"
            detail={gbp(operatingExpensePence)}
            action="Costs"
            onClick={onCostsPanel}
          />
        </div>
      </section>

      <section className="panel quick-command-panel">
        <div className="panel-heading">
          <h2>Commands</h2>
          <span className="muted">daily tools</span>
        </div>
        <div className="command-grid">
          <button type="button" onClick={onNewBuy}>Comp buy</button>
          <button type="button" onClick={() => onOpeningStockImport()}>Import stock</button>
          <button type="button" onClick={sellStock}>Sell stock</button>
          <button type="button" onClick={onListingDesk}>List drafts</button>
          <button type="button" onClick={onTakePortfolioSnapshot} disabled={busy === "snapshot"}>
            {busy === "snapshot" ? "Snapshot..." : "Snapshot"}
          </button>
          <button type="button" onClick={() => {
            onBuyWatchesPanel();
            onCheckWatches();
          }} disabled={busy === "watch-check"}>
            {busy === "watch-check" ? "Checking..." : "Targets"}
          </button>
          <button type="button" onClick={onCheckReprices} disabled={busy === "reprice"}>
            {busy === "reprice" ? "Checking..." : "Reprice"}
          </button>
          <button type="button" onClick={onProfit}>Profit</button>
          <button type="button" onClick={onCostsPanel}>Add cost</button>
          <a className="export-link" href="/api/export/books" download>Books CSV</a>
          <a className="export-link" href="/api/export/listings?state=DRAFT" download>Draft CSV</a>
          <a className="export-link" href="/api/export/listing-pack" download>Listing pack</a>
        </div>
      </section>
    </section>
  );
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

function SourceHealthRow({ source }: { source: TodaySystemSource }) {
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

function OperatingSnapshotCard({ row }: { row: OperatingSnapshotRow }) {
  return (
    <div className={`operating-snapshot-card ${row.tone}`}>
      <span>{row.label}</span>
      <strong>{row.value}</strong>
      <small>{row.detail}</small>
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

function sourceStatusLabel(status: TodaySystemSource["status"]): string {
  if (status === "ready") return "ready";
  if (status === "public") return "public";
  if (status === "fixture") return "fixture";
  if (status === "building") return "building";
  if (status === "problem") return "problem";
  return "missing";
}

function sourceStatusTone(status: TodaySystemSource["status"]): string {
  if (status === "ready" || status === "building") return "good";
  if (status === "public") return "info";
  if (status === "fixture") return "warn";
  if (status === "problem") return "danger";
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

function channelLabel(channel: string): string {
  if (channel === "EBAY") return "eBay";
  if (channel === "CARDMARKET") return "Cardmarket";
  if (channel === "VINTED") return "Vinted";
  return "In person";
}

function listingQueueLabel(listing: TodayListing): string {
  const item = listing.item;
  if (!item) return listing.title ?? "draft";
  return [item.card.name, item.card.number].filter(Boolean).join(" ");
}

function inventoryDisplayImage(item: TodayListingItem | undefined | null): string | null {
  return item?.photos?.[0]?.url ?? item?.card.imageUrl ?? null;
}

function gbp(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`;
}
