/** Phone widths, and short landscape where the sticky bar is the phone header. */
export function stickyHeaderCoversFocus(): boolean {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return width <= 719 || (width >= 720 && width <= 1024 && height <= 500);
}

/**
 * Pixels to add to window scroll so a focused control clears the sticky header
 * or the dock. Zero when it is already clear. Browsers skip scroll-padding
 * when the control is already partly on screen, so focus has to scroll itself.
 */
export function stickyFocusScrollDelta(target: HTMLElement, header: HTMLElement, dock: HTMLElement | null): number {
  if (header.contains(target) || dock?.contains(target)) return 0;
  const position = getComputedStyle(target).position;
  if (position === "fixed" || position === "sticky") return 0;
  const rect = target.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return 0;
  const headerBottom = header.getBoundingClientRect().bottom;
  if (rect.top < headerBottom - 1) return rect.top - headerBottom;
  if (dock) {
    const dockTop = dock.getBoundingClientRect().top;
    if (rect.bottom > dockTop + 1) return rect.bottom - dockTop;
  }
  return 0;
}
