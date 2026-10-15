import assert from "node:assert/strict";
import test from "node:test";
import type { CardPriceHistory } from "@/lib/comps/priceHistory";
import { buildPriceHistoryPoints, plotHistoryPoints } from "./PriceHistory.js";

const history: CardPriceHistory = {
  card: { id: "card-1", name: "Pikachu", setName: "Crown Zenith", number: "GG30", imageUrl: null, displayImageUrl: null },
  grade: "RAW",
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-11T00:00:00.000Z" },
  snapshots: [{ takenAt: "2026-07-01T00:00:00.000Z", marketPence: 1000 }, { takenAt: "2026-07-11T00:00:00.000Z", marketPence: 1400 }],
  comps: [],
  inventory: [{ id: "item-1", acquiredAt: "2026-07-02T00:00:00.000Z", costBasis: 700 }],
  listings: [{ itemId: "item-1", id: "listing-1", createdAt: "2026-07-03T00:00:00.000Z", updatedAt: "2026-07-03T00:00:00.000Z", suggestedPrice: 1600, listPrice: 1500, state: "ACTIVE", channel: "EBAY" }],
  sales: [{ itemId: "item-1", soldAt: "2026-07-10T00:00:00.000Z", salePrice: 1450, fees: 100, postage: 175 }],
};

test("history points preserve market plus owned cost/listing/sold overlays in pence", () => {
  const points = buildPriceHistoryPoints(history);
  assert.deepEqual(points.map((point) => point.kind), ["market", "market", "cost", "listing", "sold"]);
  assert.deepEqual(points.map((point) => point.pence), [1000, 1400, 700, 1500, 1450]);
});

test("history plot is deterministic and bounded", () => {
  const points = plotHistoryPoints(buildPriceHistoryPoints(history), 100, 50);
  assert.ok(points.every((point) => point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 50));
  assert.deepEqual(points[0] && { x: points[0].x, y: points[0].y }, { x: 0, y: 31.25 });
});
