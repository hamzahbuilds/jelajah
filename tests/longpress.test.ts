import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLongPress } from '../src/hooks/useLongPress';

describe('createLongPress', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('down -> 500ms -> up: long fires once, click is suppressed', () => {
    const onLong = vi.fn();
    const lp = createLongPress(onLong, 450);
    lp.down();
    vi.advanceTimersByTime(500);
    expect(onLong).toHaveBeenCalledTimes(1);
    lp.up();
    expect(lp.shouldSuppressClick()).toBe(true);
  });

  it('down -> 200ms -> up: no long fires, click is allowed', () => {
    const onLong = vi.fn();
    const lp = createLongPress(onLong, 450);
    lp.down();
    vi.advanceTimersByTime(200);
    lp.up();
    expect(onLong).not.toHaveBeenCalled();
    expect(lp.shouldSuppressClick()).toBe(false);
  });

  it('down -> pointerleave: cancelled, no long fires and a later click is not suppressed', () => {
    const onLong = vi.fn();
    const lp = createLongPress(onLong, 450);
    lp.down();
    vi.advanceTimersByTime(200);
    lp.leave();
    vi.advanceTimersByTime(1000);
    expect(onLong).not.toHaveBeenCalled();
    expect(lp.shouldSuppressClick()).toBe(false);
  });

  it('cancel() behaves like leave: clears the pending timer', () => {
    const onLong = vi.fn();
    const lp = createLongPress(onLong, 450);
    lp.down();
    vi.advanceTimersByTime(100);
    lp.cancel();
    vi.advanceTimersByTime(1000);
    expect(onLong).not.toHaveBeenCalled();
    expect(lp.shouldSuppressClick()).toBe(false);
  });

  it('a fresh down/up cycle after a long-press resets suppression', () => {
    const onLong = vi.fn();
    const lp = createLongPress(onLong, 450);
    lp.down();
    vi.advanceTimersByTime(500);
    lp.up();
    expect(lp.shouldSuppressClick()).toBe(true);

    lp.down();
    vi.advanceTimersByTime(100);
    lp.up();
    expect(lp.shouldSuppressClick()).toBe(false);
  });

  it('final-review F14: after up() suppresses the immediate click, a later keyboard Enter is not suppressed', () => {
    const onLong = vi.fn();
    const lp = createLongPress(onLong, 450);
    lp.down();
    vi.advanceTimersByTime(500);
    lp.up();
    // The click event synchronous with this pointerup is still suppressed.
    expect(lp.shouldSuppressClick()).toBe(true);
    // Once the deferred reset has had a chance to run (next tick), a later
    // keyboard Enter — which fires click with no pointerdown/up around it —
    // must not be suppressed.
    vi.advanceTimersByTime(0);
    expect(lp.shouldSuppressClick()).toBe(false);
  });
});
