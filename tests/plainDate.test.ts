import { describe, it, expect } from 'vitest';
import {
  isYmd, toDayNumber, fromDayNumber, addDays, diffDays, nightsBetween, tripDays,
  weekdayMon0, addMonths, monthGrid, compare,
} from '../shared/plainDate';

describe('plainDate', () => {
  it('round-trips day numbers across a wide range', () => {
    expect(toDayNumber('1970-01-01')).toBe(0);
    expect(fromDayNumber(0)).toBe('1970-01-01');
    // years ~1149–2791 (4-digit years only; the format has no sign)
    for (let z = -300000; z <= 300000; z += 997) expect(toDayNumber(fromDayNumber(z))).toBe(z);
  });

  it('validates real calendar dates only', () => {
    expect(isYmd('2028-02-29')).toBe(true);
    expect(isYmd('2026-02-29')).toBe(false);
    expect(isYmd('2100-02-29')).toBe(false);
    expect(isYmd('2000-02-29')).toBe(true);
    expect(isYmd('2026-13-01')).toBe(false);
    expect(isYmd('2026-1-01')).toBe(false);
  });

  it('adds across month, year and leap-day boundaries', () => {
    expect(addDays('2026-11-29', 3)).toBe('2026-12-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts nights for stays and inclusive days for trips', () => {
    expect(nightsBetween('2026-11-29', '2026-12-07')).toBe(8);
    expect(tripDays('2026-11-29', '2026-12-07')).toBe(9);
    expect(tripDays('2026-12-01', '2026-12-01')).toBe(1);
    expect(diffDays('2026-12-07', '2026-11-29')).toBe(-8);
    expect(compare('2026-12-01', '2026-11-30')).toBe(1);
  });

  it('knows weekdays (Mon = 0)', () => {
    expect(weekdayMon0('1970-01-01')).toBe(3); // Thursday
    expect(weekdayMon0('2026-11-29')).toBe(6); // Sunday
    expect(weekdayMon0('2026-11-30')).toBe(0); // Monday
    expect(weekdayMon0('1969-12-29')).toBe(0); // negative day numbers
  });

  it('clamps month arithmetic', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('builds Monday-first month grids', () => {
    const g = monthGrid('2026-11-01'); // Nov 2026 starts on a Sunday
    expect(g.length % 7).toBe(0);
    expect(g.slice(0, 6).every(c => c === null)).toBe(true);
    expect(g[6]).toBe('2026-11-01');
    expect(g.filter(Boolean).length).toBe(30);
  });
});
