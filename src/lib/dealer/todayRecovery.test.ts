import assert from "node:assert/strict";
import test from "node:test";

import type { OperatingSnapshotRow } from "./operatingSnapshot.js";
import {
  TODAY_BLOCKED_MESSAGE,
  embeddedListingCounts,
  presentOperatingSnapshot,
  todayActionsForRecovery,
  todayColdStartRecovery,
  todayMissionForRecovery,
} from "./todayRecovery.js";

const ready = { known: true, failed: false };
const coldMiss = { known: false, failed: true };
const staleMiss = { known: true, failed: true };

function input(overrides: Partial<Parameters<typeof todayColdStartRecovery>[0]> = {}) {
  return {
    inventory: ready,
    listings: ready,
    dashboard: ready,
    stockRowCount: 0,
    soldCount: 0,
    ...overrides,
  };
}

const importMission = { kind: "import" as const, title: "Load your existing singles" };
const prepareMission = { kind: "prepare" as const, title: "Prepare 1 single for sale" };

test("a total cold miss blocks Today and keeps the stock-and-sales sentence", () => {
  const recovery = todayColdStartRecovery(input({
    inventory: coldMiss,
    listings: coldMiss,
    dashboard: coldMiss,
  }));
  assert.equal(recovery.mode, "blocked");
  assert.equal(recovery.blockedMessage, TODAY_BLOCKED_MESSAGE);
  assert.equal(recovery.banner, null);
  assert.equal(recovery.questNote, null);
  assert.equal(recovery.emptyBusinessMission, null);
});

test("sales failing on an empty stock book does not become a new business", () => {
  const recovery = todayColdStartRecovery(input({ dashboard: coldMiss, stockRowCount: 0 }));
  assert.equal(recovery.mode, "partial");
  assert.equal(recovery.trustStock, true);
  assert.equal(recovery.trustSales, false);
  assert.equal(recovery.banner, "Couldn't load sales. Stock on this device is empty, so this is not a new business.");
  assert.equal(recovery.questNote, "Sales have to load before this quest can move.");
  assert.equal(recovery.emptyBusinessMission?.title, "Sales didn't load");
  assert.match(recovery.emptyBusinessMission?.detail ?? "", /not a new business/);
  assert.equal(todayMissionForRecovery(importMission, recovery).kind, "recovery");
});

test("sales failing keeps a loaded stock mission and hides sales-only quest actions", () => {
  const recovery = todayColdStartRecovery(input({ dashboard: coldMiss, stockRowCount: 2, soldCount: 4 }));
  assert.equal(recovery.banner, "Couldn't load sales. Stock already loaded stays on screen.");
  assert.equal(todayMissionForRecovery(prepareMission, recovery), prepareMission);
  const actions = todayActionsForRecovery([
    { id: "first-sale" },
    { id: "log-first-cost" },
    { id: "unlisted-stock" },
    { id: "buy-target" },
  ], recovery);
  assert.deepEqual(actions.map((action) => action.id), ["unlisted-stock", "buy-target"]);
});

test("stock failing with sales on the ledger reviews those sales instead of an empty book", () => {
  const recovery = todayColdStartRecovery(input({ inventory: coldMiss, soldCount: 2 }));
  assert.equal(recovery.banner, "Couldn't load stock. Sales already loaded are still shown.");
  assert.equal(recovery.questNote, "Stock has to load before this quest can move.");
  assert.equal(recovery.emptyBusinessMission, null);
  assert.equal(todayMissionForRecovery({ kind: "review-sales", title: "Review sales before replenishing" }, recovery).kind, "review-sales");
});

test("stock failing with an empty sales ledger is not a new business", () => {
  const recovery = todayColdStartRecovery(input({ inventory: coldMiss, soldCount: 0 }));
  assert.equal(recovery.banner, "Couldn't load stock. No sales are on the loaded ledger, so this is not a new business.");
  assert.equal(recovery.emptyBusinessMission?.title, "Stock didn't load");
  assert.equal(recovery.emptyBusinessMission?.target, "retry");
  const actions = todayActionsForRecovery([
    { id: "opening-stock" },
    { id: "first-buy" },
    { id: "buy-target" },
  ], recovery);
  assert.deepEqual(actions.map((action) => action.id), ["buy-target"]);
});

test("a listings miss keeps stock and sales and drops listing-desk actions", () => {
  const recovery = todayColdStartRecovery(input({ listings: coldMiss, stockRowCount: 1 }));
  assert.equal(recovery.mode, "partial");
  assert.equal(recovery.trustStock, true);
  assert.equal(recovery.trustSales, true);
  assert.equal(recovery.trustListings, false);
  assert.equal(recovery.banner, "Couldn't load listings. Your stock and sales are still shown.");
  assert.equal(recovery.questNote, null);
  assert.equal(recovery.emptyBusinessMission, null);
  const actions = todayActionsForRecovery([
    { id: "draft-listings" },
    { id: "reprice" },
    { id: "comp-next-buy" },
  ], recovery);
  assert.deepEqual(actions.map((action) => action.id), ["comp-next-buy"]);
});

test("a later refresh failure names the refresh and keeps the last book", () => {
  const recovery = todayColdStartRecovery(input({
    inventory: staleMiss,
    listings: staleMiss,
    dashboard: staleMiss,
    stockRowCount: 3,
    soldCount: 1,
  }));
  assert.equal(recovery.mode, "partial");
  assert.equal(recovery.banner, "Couldn't refresh stock, listings and sales. The last loaded book is still shown.");
  assert.equal(recovery.questNote, null);
  assert.equal(recovery.emptyBusinessMission, null);
});

test("a clean load has no banner and allows the empty-business mission", () => {
  const recovery = todayColdStartRecovery(input());
  assert.equal(recovery.mode, "ready");
  assert.equal(recovery.banner, null);
  assert.equal(recovery.blockedMessage, null);
  assert.equal(todayMissionForRecovery(importMission, recovery), importMission);
});

test("embedded listing counts and the dealer pulse do not invent zeros", () => {
  assert.deepEqual(embeddedListingCounts([
    { listings: [{ state: "DRAFT" }, { state: "ACTIVE" }] },
    { listings: [{ state: "SOLD" }] },
  ]), { drafts: 1, live: 1 });

  const rows: OperatingSnapshotRow[] = [
    { id: "stock-cost", label: "Stock at cost", value: "£0.00", detail: "cash tied up", tone: "warn" },
    { id: "cash-net", label: "Calculated recovery", value: "£0.00", detail: "payouts unverified", tone: "info" },
    { id: "listing-pipeline", label: "Listing pipe", value: "0 live / 0 draft", detail: "nothing listed yet", tone: "info" },
    { id: "sell-through", label: "Sell-through", value: "0%", detail: "0% recorded cost recovery", tone: "info" },
  ];
  const salesDown = todayColdStartRecovery(input({ dashboard: coldMiss, listings: coldMiss, stockRowCount: 1 }));
  const masked = presentOperatingSnapshot(rows, salesDown, { drafts: 1, live: 0 });
  assert.equal(masked[0]?.value, "Not loaded");
  assert.equal(masked[1]?.value, "Not loaded");
  assert.equal(masked[2]?.value, "0 live / 1 draft");
  assert.match(masked[2]?.detail ?? "", /stock book/);
  assert.equal(masked[3]?.value, "Not loaded");
  assert.deepEqual(presentOperatingSnapshot(rows, todayColdStartRecovery(input()), null), rows);
});
