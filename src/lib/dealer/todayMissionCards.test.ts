import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";

import { TodayTab } from "../../app/components/TodayTab.js";
import type { TodayRecovery } from "./todayRecovery.js";

const ready: TodayRecovery = {
  mode: "ready",
  blockedMessage: null,
  banner: null,
  trustStock: true,
  trustListings: true,
  trustSales: true,
  questNote: null,
  emptyBusinessMission: null,
};

const noop = () => {};

async function markup(salesToReconcile: Array<{ id: string; name?: string; cardName?: string; channel?: string; soldAt?: string }>) {
  // react-dom/server is present at runtime; this repo does not ship its types.
  // @ts-expect-error TS7016 — no declaration file for react-dom/server.
  const server = await import("react-dom/server");
  const renderToStaticMarkup = server.renderToStaticMarkup as (element: unknown) => string;
  return renderToStaticMarkup(createElement(TodayTab, {
    todayActions: [],
    primaryTodayAction: null,
    onOpenTodayAction: noop,
    onNewBuy: noop,
    dashboard: {
      metrics: { stockCount: 0, soldCount: 2, operatingExpensePence: 0, provisionalSaleCount: salesToReconcile.length },
      recentSales: [],
      salesToReconcile,
      salesToReconcileCount: salesToReconcile.length,
    },
    stockItems: [],
    operatingSnapshot: [],
    onProfit: noop,
    firstSaleListingTarget: null,
    activeListingCount: 0,
    draftListingCount: 0,
    listingsLength: 0,
    activeWatchCount: 0,
    onActiveListings: noop,
    onRecordSale: noop,
    launchPlan: [],
    launchProgress: { doneCount: 4, totalCount: 4, label: "4/4 milestones", nextLabel: "First-sale quest complete" },
    onOpenLaunchPlan: noop,
    launchReadiness: [],
    onOpenLaunchReadiness: noop,
    systemStatus: null,
    setupSources: [],
    onOpeningStockImport: noop,
    onListingDesk: noop,
    onInventory: noop,
    onSalesDesk: noop,
    onBuyWatchesPanel: noop,
    onCostsPanel: noop,
    busy: null,
    onDownloadBackup: noop,
    onTakePortfolioSnapshot: noop,
    onCheckWatches: noop,
    onCheckReprices: noop,
    onDeepCheck: noop,
    appAlerts: [],
    appAlertUnreadCount: 0,
    onMarkAlertsRead: noop,
    manualReviews: [],
    manualReviewBusyId: null,
    onAcceptManualReview: noop,
    onAddReviewCheckedComp: noop,
    orderSyncStatus: { unmatchedCount: 0, lastSuccessfulSyncAt: null, statusKnown: true },
    recovery: ready,
  }));
}

test("Today mission rows use the dashboard sale name", async () => {
  const html = await markup([{ id: "sale-1", name: "Dragonite V", channel: "EBAY", soldAt: "2026-07-07T12:00:00.000Z" }]);
  assert.match(html, /Dragonite V/);
  assert.doesNotMatch(html, /<strong>Sale<\/strong>/);
});

test("Today mission rows fall back to cardName, then Sale", async () => {
  assert.match(await markup([{ id: "sale-2", cardName: "Mimikyu" }]), /Mimikyu/);
  assert.match(await markup([{ id: "sale-3" }]), /<strong>Sale<\/strong>/);
});
