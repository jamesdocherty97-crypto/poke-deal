"use client";

import { useEffect, useMemo, useState } from "react";
import type { TodayAction, TodayActionTarget } from "@/lib/dealer/today";
import type { ManualCompReview } from "@/lib/comps/manualReview";
import type { OperatingSnapshotRow } from "@/lib/dealer/operatingSnapshot";
import type { LaunchPlanItem, LaunchProgress, LaunchPlanTarget } from "@/lib/dealer/launchPlan";
import type { LaunchReadinessItem, LaunchReadinessTarget } from "@/lib/dealer/launchReadiness";
import { formatGbp as gbp } from "@/lib/format/money";
import { ManualReviewQueue } from "./ManualReviewQueue";
import { CardImage, WorkspaceSkeleton } from "./UiBits";

type TodayDashboard = {
  metrics: { stockCount: number; soldCount: number; operatingExpensePence: number };
  recentSales?: Array<{ soldAt: string; profitPence: number }>;
};

type TodayListing = {
  id: string;
  channel: "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
  listPrice: number | null;
  suggestedPrice: number | null;
  item?: {
    grade: string;
    card: {
      name: string;
      setName: string;
      number: string | null;
      imageUrl: string | null;
      displayImageUrl?: string | null;
    };
    photos?: Array<{ url: string; order: number }>;
  };
};

type AppAlert = {
  id: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};

type SetupSource = {
  id: string;
  label: string;
  status: "ready" | "public" | "fixture" | "missing" | "building" | "problem" | "info";
  required: boolean;
};

type SystemStatus = {
  summary: {
    livePrimaryComps: boolean;
    liveCatalogKey: boolean;
    secondaryCrossCheck: boolean;
    alertDelivery: boolean;
    storedSales: boolean;
  };
};

type TodayProps = {
  todayActions: TodayAction[];
  primaryTodayAction: TodayAction | null;
  onOpenTodayAction: (target: TodayActionTarget) => void;
  onNewBuy: () => void;
  dashboard: TodayDashboard | null;
  operatingSnapshot: OperatingSnapshotRow[];
  onProfit: () => void;
  firstSaleListingTarget: TodayListing | null;
  activeListingCount: number;
  draftListingCount: number;
  listingsLength: number;
  activeWatchCount: number;
  onActiveListings: () => void;
  onRecordSale: (listing: TodayListing) => void;
  launchPlan: LaunchPlanItem[];
  launchProgress: LaunchProgress;
  onOpenLaunchPlan: (target: LaunchPlanTarget) => void;
  launchReadiness: LaunchReadinessItem[];
  onOpenLaunchReadiness: (target: LaunchReadinessTarget | undefined) => void;
  systemStatus: SystemStatus | null;
  setupSources: SetupSource[];
  onOpeningStockImport: () => void;
  onListingDesk: () => void;
  onInventory: () => void;
  onSalesDesk: () => void;
  onBuyWatchesPanel: () => void;
  onCostsPanel: () => void;
  busy: string | null;
  onDownloadBackup: () => void;
  onTakePortfolioSnapshot: () => void;
  onCheckWatches: () => void;
  onCheckReprices: () => void;
  onDeepCheck: () => void;
  appAlerts: AppAlert[];
  appAlertUnreadCount: number;
  onMarkAlertsRead: () => void;
  manualReviews: ManualCompReview[];
  manualReviewBusyId: string | null;
  onAcceptManualReview: (review: ManualCompReview) => void;
  onAddReviewCheckedComp: (review: ManualCompReview, input: { pricePence: number; soldDate: string; condition?: string; priceBasis: "ITEM_PRICE" | "BUYER_TOTAL" | "BEST_OFFER_UNKNOWN"; sourceUrl: string; note?: string }) => void;
  loading?: boolean;
};

export function TodayTab({
  todayActions,
  primaryTodayAction,
  onOpenTodayAction,
  onNewBuy,
  dashboard,
  operatingSnapshot,
  onProfit,
  firstSaleListingTarget,
  activeListingCount,
  draftListingCount,
  listingsLength,
  activeWatchCount,
  onActiveListings,
  onRecordSale,
  launchPlan,
  launchProgress,
  onOpenLaunchPlan,
  launchReadiness,
  onOpenLaunchReadiness,
  systemStatus,
  setupSources,
  onOpeningStockImport,
  onListingDesk,
  onInventory,
  onSalesDesk,
  onBuyWatchesPanel,
  onCostsPanel,
  busy,
  onDownloadBackup,
  onTakePortfolioSnapshot,
  onCheckWatches,
  onCheckReprices,
  onDeepCheck,
  appAlerts,
  appAlertUnreadCount,
  onMarkAlertsRead,
  manualReviews,
  manualReviewBusyId,
  onAcceptManualReview,
  onAddReviewCheckedComp,
  loading = false,
}: TodayProps) {
  const greeting = useTodayGreeting();
  const [reviewOpen, setReviewOpen] = useState(false);
  const yesterdayKey = dateKey(new Date(Date.now() - 24 * 60 * 60 * 1_000));
  const yesterdayProfitPence = (dashboard?.recentSales ?? [])
    .filter((sale) => dateKey(new Date(sale.soldAt)) === yesterdayKey)
    .reduce((sum, sale) => sum + sale.profitPence, 0);
  const missionIsReview = manualReviews.length > 0;
  const missionTitle = missionIsReview
    ? `Resolve ${manualReviews.length} cautious comp${manualReviews.length === 1 ? "" : "s"}`
    : primaryTodayAction?.title ?? "Comp your next card";
  const missionDetail = missionIsReview
    ? "Compare disagreeing sources before the next buying decision."
    : primaryTodayAction?.detail ?? "Open a clean comparison and set your maximum buy price.";
  const secondaryActions = todayActions
    .filter((action) => action.id !== primaryTodayAction?.id)
    .slice(0, 4);
  const nextLaunchStep = launchPlan.find((item) => item.state !== "done") ?? launchPlan[0] ?? null;
  const readinessAttention = launchReadiness.filter((item) => item.state !== "done").slice(0, 2);
  const readinessPercent = launchProgress.totalCount > 0
    ? Math.round((launchProgress.doneCount / launchProgress.totalCount) * 100)
    : 0;
  const readySourceCount = setupSources.filter((source) => source.status === "ready" || source.status === "public" || source.status === "info").length;
  const latestUnreadAlert = useMemo(
    () => appAlerts.find((alert) => !alert.readAt) ?? null,
    [appAlerts],
  );
  const saleCard = firstSaleListingTarget?.item ?? null;
  const saleCardImage = saleCard ? listingCardImage(saleCard) : null;

  function openMission() {
    if (missionIsReview) {
      setReviewOpen(true);
      window.requestAnimationFrame(() => document.getElementById("manual-review-queue")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }
    if (primaryTodayAction) {
      onOpenTodayAction(primaryTodayAction.target);
      return;
    }
    onNewBuy();
  }

  if (loading) return <section className="workspace today-workspace"><WorkspaceSkeleton label="Loading today's work" rows={3} /></section>;

  return (
    <section className="workspace today-workspace focused-today">
      <header className="workspace-masthead today-command" aria-labelledby="today-command-title">
        <div className="today-command-copy">
          <span className="workspace-eyebrow">{greeting}, Trainer · dealer command centre</span>
          <span className={`today-command-priority ${missionIsReview ? "warn" : primaryTodayAction?.tone ?? "good"}`}>Priority one</span>
          <h2 id="today-command-title">{missionTitle}</h2>
          <p>{missionDetail}</p>
          <div className="today-command-actions">
            <button type="button" className="primary-button" onClick={openMission}>
              {missionIsReview ? "Review comps" : primaryTodayAction ? primaryActionLabel(primaryTodayAction.target) : "Comp / buy"}
            </button>
            <button type="button" className="ghost-button" onClick={onNewBuy}>New comp / buy</button>
          </div>
        </div>

        <div className="today-command-progress" aria-label={`Dealer readiness: ${launchProgress.label}`}>
          <div className="today-command-progress-heading">
            <span>Dealer readiness</span>
            <strong>{launchProgress.label}</strong>
          </div>
          <div
            className="today-progress-track"
            role="progressbar"
            aria-label="Dealer readiness"
            aria-valuemin={0}
            aria-valuemax={launchProgress.totalCount}
            aria-valuenow={launchProgress.doneCount}
          >
            <span style={{ width: `${readinessPercent}%` }} />
          </div>
          <p>{launchProgress.nextLabel.replace(/^Next:/, "Setup gap:")}</p>
          {nextLaunchStep && (
            <button type="button" className="text-button" onClick={() => onOpenLaunchPlan(nextLaunchStep.target)}>
              Next work · {nextLaunchStep.action}: {nextLaunchStep.title}
            </button>
          )}
        </div>
      </header>

      <div className="today-command-grid">
        <section className="priority-queue" aria-labelledby="priority-queue-title">
          <div className="priority-queue-heading">
            <div>
              <span className="workspace-eyebrow">Today&apos;s quest log</span>
              <h2 id="priority-queue-title">Next moves</h2>
              <p>Highest-impact work first. Clear the queue without hunting through menus.</p>
            </div>
            <span className="pill good">{secondaryActions.length + (missionIsReview ? 1 : 0)} queued</span>
          </div>

          <ol className="today-action-list">
            {missionIsReview && (
              <li>
                <button
                  className="today-action warn manual-review-action"
                  type="button"
                  aria-expanded={reviewOpen}
                  aria-controls="manual-review-queue"
                  onClick={() => setReviewOpen((current) => !current)}
                >
                  <span className="today-action-index" aria-hidden="true">01</span>
                  <span>
                    <strong>Professor&apos;s review</strong>
                    <small>{manualReviews.length} cautious comp{manualReviews.length === 1 ? "" : "s"} waiting for a source check</small>
                  </span>
                  <b aria-hidden="true">›</b>
                </button>
              </li>
            )}
            {secondaryActions.map((action, index) => (
              <li key={action.id}>
                <button className={`today-action ${action.tone}`} type="button" onClick={() => onOpenTodayAction(action.target)}>
                  <span className="today-action-index" aria-hidden="true">{String(index + (missionIsReview ? 2 : 1)).padStart(2, "0")}</span>
                  <span><strong>{action.title}</strong><small>{action.detail}</small></span>
                  <b aria-hidden="true">›</b>
                </button>
              </li>
            ))}
          </ol>

          {firstSaleListingTarget && saleCard && (
            <article className="deal-sleeve sale-ready-sleeve">
              <div className="deal-sleeve-art">
                <CardImage
                  src={saleCardImage}
                  className="deal-sleeve-card"
                  fallbackClassName="deal-sleeve-card blank"
                  alt={`${saleCard.card.name} card artwork`}
                  eager
                />
              </div>
              <div className="deal-sleeve-ticket">
                <span className="workspace-eyebrow">Sale ready</span>
                <h3>{saleCard.card.name}</h3>
                <p>{[saleCard.card.setName, saleCard.card.number, saleCard.grade].filter(Boolean).join(" · ")}</p>
                <dl>
                  <div><dt>Channel</dt><dd>{channelLabel(firstSaleListingTarget.channel)}</dd></div>
                  <div><dt>Ask</dt><dd>{gbp(firstSaleListingTarget.listPrice ?? firstSaleListingTarget.suggestedPrice ?? 0)}</dd></div>
                </dl>
                <button type="button" onClick={() => onRecordSale(firstSaleListingTarget)}>Book sale</button>
              </div>
            </article>
          )}
        </section>

        <aside className="status-rail" aria-label="Dealer status">
          <section className="dealer-pulse" aria-labelledby="dealer-pulse-title">
            <div className="dealer-pulse-heading">
              <div>
                <span className="workspace-eyebrow">Live desk</span>
                <h2 id="dealer-pulse-title">Dealer pulse</h2>
              </div>
              <span className={`system-indicator ${systemStatus ? "good" : "warn"}`}>
                {systemStatus ? `${readySourceCount}/${setupSources.length} sources` : "Checking systems"}
              </span>
            </div>

            <dl className="dealer-pulse-ledger">
              {operatingSnapshot.map((row) => (
                <div className={`dealer-pulse-row ${row.tone}`} key={row.id}>
                  <dt><span>{row.label}</span><small>{row.detail}</small></dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>

            <div className="dealer-pulse-status" aria-label="Current work counts">
              <button type="button" onClick={onActiveListings} disabled={activeListingCount === 0}>
                <strong>{activeListingCount}</strong><span>live</span>
              </button>
              <button type="button" onClick={onListingDesk} disabled={draftListingCount === 0 && listingsLength === 0}>
                <strong>{draftListingCount}</strong><span>draft</span>
              </button>
              <button type="button" onClick={onBuyWatchesPanel}>
                <strong>{activeWatchCount}</strong><span>targets</span>
              </button>
            </div>

            {readinessAttention.length > 0 && (
              <div className="readiness-brief" aria-label="Readiness attention">
                {readinessAttention.map((item) => (
                  <div className={`readiness-brief-row ${item.state}`} key={item.id}>
                    <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                    {item.target && item.target !== "external" && (
                      <button type="button" onClick={() => onOpenLaunchReadiness(item.target)}>{item.action ?? "Open"}</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {latestUnreadAlert && (
              <div className="dealer-alert">
                <span><strong>{latestUnreadAlert.title}</strong><small>{latestUnreadAlert.message}</small></span>
                <button type="button" onClick={onMarkAlertsRead}>Mark read</button>
              </div>
            )}

            <div className="dealer-pulse-actions">
              <button type="button" onClick={onProfit}>Open profit ledger</button>
              <button type="button" onClick={activeListingCount > 0 ? onSalesDesk : onInventory}>
                {activeListingCount > 0 ? "Book a sale" : "Open stock vault"}
              </button>
            </div>

            <details className="dealer-tools">
              <summary>Desk tools</summary>
              <div>
                <button type="button" onClick={onOpeningStockImport}>Import opening stock</button>
                <button type="button" onClick={onCostsPanel}>Log a cost</button>
                <button type="button" onClick={onCheckWatches} disabled={Boolean(busy)}>Check buy targets</button>
                <button type="button" onClick={onCheckReprices} disabled={Boolean(busy)}>Check repricing</button>
                <button type="button" onClick={onTakePortfolioSnapshot} disabled={Boolean(busy)}>Snapshot portfolio</button>
                <button type="button" onClick={onDownloadBackup} disabled={Boolean(busy)}>Download backup</button>
                <button type="button" onClick={onDeepCheck} disabled={Boolean(busy)}>Check systems</button>
              </div>
            </details>

            <footer className="dealer-pulse-footer">
              <span>Yesterday</span>
              <strong>{gbp(yesterdayProfitPence)} P&amp;L</strong>
              {appAlertUnreadCount > 0 && <small>{appAlertUnreadCount} unread alert{appAlertUnreadCount === 1 ? "" : "s"}</small>}
            </footer>
          </section>
        </aside>
      </div>

      {reviewOpen && (
        <section className="panel manual-review-panel" id="manual-review-queue" aria-labelledby="manual-review-title">
          <div className="panel-heading">
            <div><h2 id="manual-review-title">Professor&apos;s review</h2><span className="muted">reason + source spread · resolve in one more tap</span></div>
            <button className="ghost-button" type="button" onClick={() => setReviewOpen(false)}>Close</button>
          </div>
          <ManualReviewQueue
            reviews={manualReviews}
            busyId={manualReviewBusyId}
            onAccept={onAcceptManualReview}
            onAddCheckedComp={onAddReviewCheckedComp}
          />
        </section>
      )}
    </section>
  );
}

function useTodayGreeting(): string {
  const [greeting, setGreeting] = useState("Good day");
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
  }, []);
  return greeting;
}

function dateKey(value: Date): string {
  if (Number.isNaN(value.getTime())) return "invalid";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function primaryActionLabel(target: TodayActionTarget): string {
  if (target === "opening-stock") return "Import stock";
  if (target === "buy") return "Start comp";
  if (target === "sales") return "Book sale";
  if (target === "drafts") return "Open listing desk";
  if (target === "watches") return "Open buy targets";
  if (target === "reprice") return "Check repricing";
  if (target === "profit") return "Open profit ledger";
  return "Open stock vault";
}

function listingCardImage(item: NonNullable<TodayListing["item"]>): string | null {
  const primaryPhoto = [...(item.photos ?? [])].sort((left, right) => left.order - right.order)[0];
  return primaryPhoto?.url ?? item.card.imageUrl ?? item.card.displayImageUrl ?? null;
}

function channelLabel(channel: TodayListing["channel"]): string {
  if (channel === "EBAY") return "eBay";
  if (channel === "CARDMARKET") return "Cardmarket";
  if (channel === "IN_PERSON") return "In person";
  return "Vinted";
}
