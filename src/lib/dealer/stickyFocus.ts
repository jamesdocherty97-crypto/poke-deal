/** Phone widths, and short landscape where the sticky bar is the phone header. */
export function stickyHeaderCoversFocus(): boolean {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return width <= 719 || (width >= 720 && width <= 1024 && height <= 500);
}

const SHEET = ".sell-sheet, .scan-sheet, .confirm-sheet, .listing-pack-sheet, .command-palette, .mobile-more-menu, [role='dialog'], [aria-modal='true']";

let lastPointerDownAt = 0;

/** A tap focuses on a later turn than pointerdown. Treat that focus as a pointer. */
export function noteStickyFocusPointerDown(): void {
  lastPointerDownAt = performance.now();
}

export function focusCameFromPointer(): boolean {
  return performance.now() - lastPointerDownAt < 400;
}

function coveredByChrome(target: HTMLElement): boolean {
  if (target.closest(SHEET)) return true;
  let node: HTMLElement | null = target;
  while (node) {
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") return true;
    node = node.parentElement;
  }
  return false;
}

export type StickyFocusRect = { top: number; bottom: number };

/**
 * Pixels to add to window scroll. Negative moves the control down from under
 * the header. Positive lifts it off the dock. A control taller than the gap
 * is aligned to the header instead of being pushed underneath it.
 */
export function stickyFocusScrollDeltaForRect(
  rect: StickyFocusRect,
  headerBottom: number,
  dockTop: number | null,
  viewportHeight: number,
): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom) || rect.bottom <= rect.top) return 0;
  if (!Number.isFinite(headerBottom)) return 0;
  const alignToHeader = rect.top - headerBottom;
  if (rect.top < headerBottom - 1) return alignToHeader;
  if (dockTop == null || !Number.isFinite(dockTop) || rect.bottom <= dockTop + 1) return 0;
  const clearDock = rect.bottom - dockTop;
  if (rect.top - clearDock < headerBottom) return alignToHeader;
  return clearDock;
}

/**
 * Pixels to add to window scroll so a focused control clears the sticky header
 * or the dock. Zero when it is already clear, or when it lives in a sheet or
 * fixed layer (those must not move the page behind them). Browsers skip
 * scroll-padding when the control is already partly on screen.
 */
export function stickyFocusScrollDelta(target: HTMLElement, header: HTMLElement, dock: HTMLElement | null): number {
  if (header.contains(target) || dock?.contains(target) || coveredByChrome(target)) return 0;
  const rect = target.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return 0;
  return stickyFocusScrollDeltaForRect(
    { top: rect.top, bottom: rect.bottom },
    header.getBoundingClientRect().bottom,
    dock ? dock.getBoundingClientRect().top : null,
    window.innerHeight,
  );
}
