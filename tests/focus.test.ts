import { describe, it, expect } from 'vitest';
import { nextFocusIndex, clampMenu } from '../src/components/uiHelpers';

describe('nextFocusIndex', () => {
  it('wraps forward past the last index', () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });
  it('wraps backward past the first index on shift+tab', () => {
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });
  it('stays put with a single focusable element', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
  });
  it('advances by one in the middle, forward', () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
  });
  it('advances by one in the middle, backward', () => {
    expect(nextFocusIndex(3, 1, true)).toBe(0);
  });
});

describe('clampMenu', () => {
  it('prefers anchor.bottom + 6 for top when it fits', () => {
    const anchor = { top: 100, bottom: 120, left: 50, right: 150, width: 100, height: 20 } as DOMRect;
    const r = clampMenu(anchor, { w: 200, h: 100 }, { w: 1000, h: 800 });
    expect(r.top).toBe(126);
    expect(r.left).toBe(50);
  });
  it('clamps left to a minimum of 12', () => {
    const anchor = { top: 100, bottom: 120, left: 2, right: 50, width: 48, height: 20 } as DOMRect;
    const r = clampMenu(anchor, { w: 200, h: 100 }, { w: 1000, h: 800 });
    expect(r.left).toBe(12);
  });
  it('clamps left so the menu never overflows the right edge', () => {
    const anchor = { top: 100, bottom: 120, left: 900, right: 950, width: 50, height: 20 } as DOMRect;
    const r = clampMenu(anchor, { w: 200, h: 100 }, { w: 1000, h: 800 });
    expect(r.left).toBe(1000 - 200 - 12);
  });
  it('clamps top so the menu bottom stays within 12px of the viewport bottom', () => {
    const anchor = { top: 780, bottom: 790, left: 50, right: 150, width: 100, height: 10 } as DOMRect;
    const r = clampMenu(anchor, { w: 200, h: 100 }, { w: 1000, h: 800 });
    expect(r.top).toBe(800 - 100 - 12);
  });
});
