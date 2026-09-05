// Pure refcount test for the body-scroll lock in src/components/uiHelpers.ts.
// Modal/Sheet can nest, so lockScroll/unlockScroll share a module-level
// counter — only the outermost open/close pair should touch
// document.body.style.overflow. This guards that refcount behavior and its
// negative-count guard (extra unlockScroll calls must never go below zero).
import { describe, it, expect, beforeEach } from 'vitest';

// No jsdom in this project (node test environment) — uiHelpers only ever
// touches `document.body.style.overflow`, so a minimal stub is enough to
// exercise the refcount logic without a DOM dependency.
(globalThis as any).document = { body: { style: { overflow: '' } } };

import { lockScroll, unlockScroll } from '../src/components/uiHelpers';

describe('lockScroll/unlockScroll refcount', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('locks on the first call and restores on the matching last unlock', () => {
    lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockScroll();
    expect(document.body.style.overflow).toBe('');
  });

  it('nested lock/unlock pairs only restore overflow at the outermost unlock', () => {
    lockScroll();
    lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockScroll();
    // still locked — one outstanding lock remains
    expect(document.body.style.overflow).toBe('hidden');
    unlockScroll();
    expect(document.body.style.overflow).toBe('');
  });

  it('guards against unlockScroll going below zero (unmount-safety)', () => {
    lockScroll();
    unlockScroll();
    expect(document.body.style.overflow).toBe('');
    // extra unlock beyond the matching lock must not throw or corrupt state
    unlockScroll();
    unlockScroll();
    expect(document.body.style.overflow).toBe('');
    // a fresh lock afterwards still behaves correctly
    lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockScroll();
    expect(document.body.style.overflow).toBe('');
  });
});
