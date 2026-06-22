export const PULL_REFRESH_THRESHOLD_PX = 72;
export const PULL_REFRESH_MAX_DISTANCE_PX = 96;

export function pullRefreshDistance(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY <= 0) return 0;
  return Math.min(PULL_REFRESH_MAX_DISTANCE_PX, Math.round(deltaY * 0.45));
}

export function pullRefreshProgress(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  return Math.min(distance / PULL_REFRESH_THRESHOLD_PX, 1);
}

export function shouldTriggerPullRefresh(distance: number): boolean {
  return pullRefreshProgress(distance) >= 1;
}
