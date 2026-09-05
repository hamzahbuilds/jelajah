import { describe, it, expect } from 'vitest';
import { fillDays, trendPct, lastNDaysUtc } from '../shared/metrics';

describe('metrics', () => {
  it('zero-fills missing days across the range, inclusive', () => {
    expect(fillDays([{ day: '2026-09-03', n: 2 }], '2026-09-01', '2026-09-04')).toEqual([
      { day: '2026-09-01', n: 0 }, { day: '2026-09-02', n: 0 },
      { day: '2026-09-03', n: 2 }, { day: '2026-09-04', n: 0 },
    ]);
  });
  it('orders unordered input and drops out-of-range days', () => {
    const out = fillDays(
      [{ day: '2026-09-02', n: 5 }, { day: '2026-08-31', n: 9 }, { day: '2026-09-01', n: 1 }],
      '2026-09-01', '2026-09-02');
    expect(out).toEqual([{ day: '2026-09-01', n: 1 }, { day: '2026-09-02', n: 5 }]);
  });
  it('single-day range works', () =>
    expect(fillDays([], '2026-09-01', '2026-09-01')).toEqual([{ day: '2026-09-01', n: 0 }]));
  it('trend: +50% and -25%, 1 dp', () => {
    expect(trendPct(15, 10)).toBe(50);
    expect(trendPct(7.5, 10)).toBe(-25);
    expect(trendPct(1, 3)).toBe(-66.7);
  });
  it('trend from zero is null, zero-to-zero is null', () => {
    expect(trendPct(5, 0)).toBeNull();
    expect(trendPct(0, 0)).toBeNull();
  });
  it('lastNDaysUtc: 7 days ending today (UTC)', () => {
    const { start, end } = lastNDaysUtc(7, new Date('2026-09-05T01:00:00Z'));
    expect(end).toBe('2026-09-05');
    expect(start).toBe('2026-08-30');
  });
  it('lastNDaysUtc uses the UTC date even late in a +08 evening', () => {
    // 23:30 in Kuching on Sep 5 is 15:30Z Sep 5 — still Sep 5 in UTC
    const { end } = lastNDaysUtc(1, new Date('2026-09-05T15:30:00Z'));
    expect(end).toBe('2026-09-05');
  });
});
