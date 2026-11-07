// Pure helper backing the Menu viewport clamp (fallback when CSS anchor
// positioning is unavailable). Modal/Sheet no longer need a focus trap or
// scroll lock — native <dialog> showModal() provides both.
// Kept dependency-free (no DOM, no React) so tests/focus.test.ts can import
// them without touching JSX.

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
