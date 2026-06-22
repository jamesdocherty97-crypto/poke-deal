import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PULL_REFRESH_MAX_DISTANCE_PX,
  PULL_REFRESH_THRESHOLD_PX,
  pullRefreshDistance,
  pullRefreshProgress,
  shouldTriggerPullRefresh,
} from "./pullRefresh.js";

test("pullRefreshDistance ignores upward or invalid pulls", () => {
  assert.equal(pullRefreshDistance(0), 0);
  assert.equal(pullRefreshDistance(-20), 0);
  assert.equal(pullRefreshDistance(Number.NaN), 0);
});

test("pullRefreshDistance dampens and caps downward pulls", () => {
  assert.equal(pullRefreshDistance(40), 18);
  assert.equal(pullRefreshDistance(400), PULL_REFRESH_MAX_DISTANCE_PX);
});

test("shouldTriggerPullRefresh only fires once the threshold is reached", () => {
  assert.equal(shouldTriggerPullRefresh(PULL_REFRESH_THRESHOLD_PX - 1), false);
  assert.equal(shouldTriggerPullRefresh(PULL_REFRESH_THRESHOLD_PX), true);
  assert.equal(pullRefreshProgress(PULL_REFRESH_THRESHOLD_PX * 2), 1);
});
