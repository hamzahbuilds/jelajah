import { describe, it, expect } from 'vitest';
import { ymd, todayYmd, daysBetween } from '../shared/days';

// Regression guard: these all passed in a UTC sandbox and broke in Malaysia (UTC+8),
// where toISOString() pushed every calendar day back by one.
describe('days', () => {
  it('keeps the local calendar date for a local-midnight Date', () => {
    expect(ymd(new Date('2026-11-29T00:00:00'))).toBe('2026-11-29');
  });

  it('keeps the local calendar date for an early-morning Date', () => {
    // the 00:10 KUL→NRT departure that used to render as 28 Nov east of UTC
    expect(ymd(new Date('2026-11-29T00:10:00'))).toBe('2026-11-29');
  });

  it('pads month and day', () => {
    expect(ymd(new Date('2026-01-05T00:00:00'))).toBe('2026-01-05');
  });

  it('lists the Japan trip as exactly 9 days starting on the start date', () => {
    const days = daysBetween('2026-11-29', '2026-12-07');
    expect(days).toHaveLength(9);
    expect(days[0]).toBe('2026-11-29');
    expect(days[days.length - 1]).toBe('2026-12-07');
  });

  it('is inclusive on a single-day trip', () => {
    expect(daysBetween('2026-11-29', '2026-11-29')).toEqual(['2026-11-29']);
  });

  it('crosses a month boundary without skipping or repeating', () => {
    expect(daysBetween('2026-11-29', '2026-12-02'))
      .toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  });

  it('crosses a leap day', () => {
    expect(daysBetween('2028-02-27', '2028-03-01'))
      .toEqual(['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('returns nothing when end precedes start', () => {
    expect(daysBetween('2026-12-07', '2026-11-29')).toEqual([]);
  });

  it('returns nothing for an unparseable date', () => {
    expect(daysBetween('not-a-date', '2026-11-29')).toEqual([]);
  });

  it('caps runaway ranges', () => {
    expect(daysBetween('2026-01-01', '2030-01-01')).toHaveLength(90);
    expect(daysBetween('2026-01-01', '2030-01-01', 5)).toHaveLength(5);
  });

  it('todayYmd reports the local date, not the UTC one', () => {
    // 07:30 local on 1 Sep is still 31 Aug in UTC for UTC+8 viewers
    expect(todayYmd(new Date('2026-09-01T07:30:00'))).toBe('2026-09-01');
  });
});
