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
  const headerBottom = header.getBoundingClientRect().bottom;
  const dockTop = dock?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
  const alignToHeader = rect.top - headerBottom;
  if (rect.top < headerBottom - 1) return alignToHeader;
  if (!dock || rect.bottom <= dockTop + 1) return 0;
  const clearDock = rect.bottom - dockTop;
  // A control taller than the gap cannot clear the dock without sliding under the header.
  if (rect.top - clearDock < headerBottom) return alignToHeader;
  return clearDock;
}
