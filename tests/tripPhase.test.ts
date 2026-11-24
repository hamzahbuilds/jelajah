import { describe, expect, it } from 'vitest';
import { phaseOf, sortTrips } from '../shared/tripPhase';

const T = (id: number, name: string, start: string | null, end: string | null = start) => ({ id, name, start_date: start, end_date: end });
const today = '2026-11-25';

describe('Home trip phases', () => {
  it('sorts each trip into now, upcoming, completed or still planning', () => {
    expect(phaseOf(T(1, 'a', '2026-11-20', '2026-11-25'), today)).toBe('now');
    expect(phaseOf(T(2, 'b', '2026-11-25', null), today)).toBe('now');
    expect(phaseOf(T(3, 'c', '2026-12-01', '2026-12-05'), today)).toBe('upcoming');
    expect(phaseOf(T(4, 'd', '2026-10-01', '2026-11-24'), today)).toBe('done');
    expect(phaseOf(T(5, 'e', null), today)).toBe('undated');
  });

  it('trip date: upcoming soonest first, completed newest first', () => {
    const up = [T(1, 'x', '2027-03-01'), T(2, 'y', '2026-12-01'), T(3, 'z', '2027-01-10')];
    expect(sortTrips(up, 'date', 'upcoming', 'en').map(t => t.id)).toEqual([2, 3, 1]);
    const done = [T(1, 'x', '2025-01-01', '2025-01-05'), T(2, 'y', '2026-06-01', '2026-06-09'), T(3, 'z', '2026-02-01', '2026-02-03')];
    expect(sortTrips(done, 'date', 'done', 'en').map(t => t.id)).toEqual([2, 3, 1]);
  });

  it('recently added and name sorts', () => {
    const list = [T(1, 'bali', '2027-01-01'), T(3, 'Arau', '2027-02-01'), T(2, 'Cebu', '2026-12-01')];
    expect(sortTrips(list, 'added', 'upcoming', 'en').map(t => t.id)).toEqual([3, 2, 1]);
    expect(sortTrips(list, 'name', 'upcoming', 'en').map(t => t.name)).toEqual(['Arau', 'bali', 'Cebu']);
    expect(list.map(t => t.id)).toEqual([1, 3, 2]); // input untouched
  });
});
