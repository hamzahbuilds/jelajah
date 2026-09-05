// Pure helpers backing the Modal focus trap and the Menu viewport clamp.
// Kept dependency-free (no DOM, no React) so tests/focus.test.ts can import
// them without touching JSX.

/** Next focusable index for a Tab keydown inside a focus trap of `count` items, wrapping in both directions. */
export function nextFocusIndex(count: number, current: number, shiftKey: boolean): number {
  if (count <= 0) return 0;
  if (shiftKey) return current <= 0 ? count - 1 : current - 1;
  return current >= count - 1 ? 0 : current + 1;
}

// Body scroll lock, refcounted (final-review F3): Modal/Sheet can nest (e.g. a
// Modal opened from within a Sheet), and each snapshotting/restoring
// `document.body.style.overflow` independently corrupts the other's state if
// the inner one closes first. A shared counter means only the outermost
// open/close pair ever touches the style.
let locks = 0;
export function lockScroll() {
  if (++locks === 1) document.body.style.overflow = 'hidden';
}
export function unlockScroll() {
  if (locks > 0 && --locks === 0) document.body.style.overflow = '';
}

export interface Size { w: number; h: number }
export interface Point { top: number; left: number }

/**
 * Fixed-position placement for a dropdown menu anchored below `anchor`,
 * clamped so it never runs past the viewport edges (12px margin).
 * Prefers anchor.bottom + 6 for the top, matching the prototype's jlMenu.
 */
export function clampMenu(anchor: DOMRect, menu: Size, vp: Size): Point {
  const top = Math.min(anchor.bottom + 6, vp.h - menu.h - 12);
  const left = Math.max(12, Math.min(anchor.left, vp.w - menu.w - 12));
  return { top, left };
}
