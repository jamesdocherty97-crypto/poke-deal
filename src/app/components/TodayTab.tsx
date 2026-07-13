"use client";

import { useEffect, useState } from "react";
import type { TodayAction, TodayActionTarget } from "@/lib/dealer/today";
import type { ManualCompReview } from "@/lib/comps/manualReview";
import { formatGbp as gbp } from "@/lib/format/money";
import { ManualReviewQueue } from "./ManualReviewQueue";
import { WorkspaceSkeleton } from "./UiBits";

type TodayDashboard = {
  metrics: { stockCount: number; soldCount: number; operatingExpensePence: number };
  recentSales?: Array<{ soldAt: string; profitPence: number }>;
};

type TodayProps = {
  todayActions: TodayAction[];
  onOpenTodayAction: (target: TodayActionTarget) => void;
  onNewBuy: () => void;
  dashboard: TodayDashboard | null;
  activeListingCount: number;
  onInventory: () => void;
  onSalesDesk: () => void;
  appAlertUnreadCount: number;
  manualReviews: ManualCompReview[];
  manualReviewBusyId: string | null;
  onAcceptManualReview: (review: ManualCompReview) => void;
  onAddReviewCheckedComp: (review: ManualCompReview, input: { pricePence: number; soldDate: string; note?: string }) => void;
  loading?: boolean;
  [extra: string]: unknown;
};

export function TodayTab({
  todayActions,
  onOpenTodayAction,
  onNewBuy,
  dashboard,
  activeListingCount,
  onInventory,
  onSalesDesk,
  appAlertUnreadCount,
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
  const actionLimit = manualReviews.length > 0 ? 4 : 5;
  const sellStock = activeListingCount > 0 ? onSalesDesk : onInventory;

  if (loading) return <section className="workspace today-workspace"><WorkspaceSkeleton label="Loading today's work" rows={3} /></section>;

  return (
    <section className="workspace today-workspace focused-today">
      <section className="today-hero-panel" aria-label="Today summary">
        <div>
          <span>{greeting}, Trainer</span>
          <h2>Today&apos;s quest log</h2>
          <p>
            Yesterday {gbp(yesterdayProfitPence)} P&amp;L · {manualReviews.length} manual check{manualReviews.length === 1 ? "" : "s"}
            {appAlertUnreadCount > 0 ? ` · ${appAlertUnreadCount} alert${appAlertUnreadCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="today-hero-actions">
          <button type="button" onClick={onNewBuy}>Comp / buy</button>
          <button type="button" onClick={sellStock}>{activeListingCount > 0 ? "Book sale" : "Stock"}</button>
        </div>
      </section>

      <section className="panel today-panel today-priority-panel">
        <div className="panel-heading">
          <div>
            <h2>Next moves</h2>
            <span className="muted">five max · highest impact first</span>
          </div>
          <span className="pill good">{Math.min(5, todayActions.length + (manualReviews.length > 0 ? 1 : 0))} quests</span>
        </div>
        <div className="today-action-list">
          {manualReviews.length > 0 && (
            <button className="today-action warn manual-review-action" type="button" onClick={() => setReviewOpen((current) => !current)}>
              <span>
                <strong>Review {manualReviews.length} cautious comp{manualReviews.length === 1 ? "" : "s"}</strong>
                <small>Compare disagreeing sources and resolve</small>
              </span>
              <b aria-hidden="true">›</b>
            </button>
          )}
          {todayActions.slice(0, actionLimit).map((action) => (
            <button className={`today-action ${action.tone}`} type="button" key={action.id} onClick={() => onOpenTodayAction(action.target)}>
              <span><strong>{action.title}</strong><small>{action.detail}</small></span><b aria-hidden="true">›</b>
            </button>
          ))}
        </div>
      </section>

      {reviewOpen && (
        <section className="panel manual-review-panel" id="manual-review-queue">
          <div className="panel-heading">
            <div><h2>Professor&apos;s review</h2><span className="muted">reason + source spread · resolve in one more tap</span></div>
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
