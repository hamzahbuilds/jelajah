import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../shared/csv';
import { transformGrid, parseTimeCell, resolveShortDate, WizardMapping } from '../shared/wizard';

// Mapping for the real client campervan CSV:
// Day,Date,Day,Time,Activity / Route,Parking Location,Overnight,Transport (¥),Accom (¥),Food (¥),Attractions (¥),Misc (¥),Day Total (¥),Day Total (RM)
const MAPPING: WizardMapping = {
  dayNo: 0, date: 1, time: 3, title: 4, notes: [5], overnight: 6,
  budgets: { transport: 7, accommodation: 8, food: 9, attractions: 10, misc: 11, total: 12 },
  budgetCurrency: 'JPY',
};

const grid = parseCsv(readFileSync('tests/fixtures/client-campervan.csv', 'utf8'));
const res = transformGrid(grid, MAPPING, '2026-12-08', '2026-12-17');

describe('wizard primitives', () => {
  it('parses time cells', () => {
    expect(parseTimeCell('08:00')).toEqual({ start: '08:00', end: null, isText: false });
    expect(parseTimeCell('11:00–13:00')).toEqual({ start: '11:00', end: '13:00', isText: false });
    expect(parseTimeCell('~17:00')).toEqual({ start: '17:00', end: null, isText: false });
    expect(parseTimeCell('Halal/Pork-Free Meal').isText).toBe(true);
  });
  it('resolves short dates from the trip range', () => {
    expect(resolveShortDate('Dec 8', '2026-12-08', '2026-12-17')).toBe('2026-12-08');
    expect(resolveShortDate('8 Dec', '2026-12-08', '2026-12-17')).toBe('2026-12-08');
  });
});

describe('client campervan CSV transform', () => {
  it('forward-fills all 10 days', () => {
    const days = new Set(res.activities.map(a => a.day));
    expect(days.size).toBe(10);
    expect(days.has('2026-12-08')).toBe(true);
    expect(days.has('2026-12-17')).toBe(true);
  });

  it('splits time ranges and keeps parking notes', () => {
    const himeji = res.activities.find(a => a.title.includes('Himeji Castle'))!;
    expect(himeji.day).toBe('2026-12-08');
    expect(himeji.start_time).toBe('11:00');
    expect(himeji.end_time).toBe('13:00');
    expect(himeji.notes).toMatch(/Parking Lot/);
  });

  it('turns meal rows into untimed note-activities', () => {
    const meals = res.activities.filter(a => a.notes?.includes('Halal/Pork-Free Meal'));
    expect(meals.length).toBeGreaterThanOrEqual(9);
    expect(meals[0].start_time).toBeNull();
  });

  it('creates lodging note-activities from the Overnight column', () => {
    const lodging = res.activities.filter(a => a.isLodging);
    expect(lodging.length).toBeGreaterThanOrEqual(8);
    expect(lodging.some(l => l.title.includes('Vessel Hotel Fukuoka'))).toBe(true);
  });

  it('extracts per-day budgets in ¥', () => {
    expect(res.budgets).toHaveLength(10);
    const d1 = res.budgets.find(b => b.day === '2026-12-08')!;
    expect(d1).toMatchObject({ currency: 'JPY', transport: 8000, accommodation: 0, food: 8500, total: 20000 });
    const ferry = res.budgets.find(b => b.day === '2026-12-15')!;
    expect(ferry.accommodation).toBe(70000);
  });

  it('skips the TOTALS row and keeps a sane activity count', () => {
    expect(res.activities.some(a => /TOTALS/i.test(a.title))).toBe(false);
    expect(res.activities.length).toBeGreaterThan(55);
    expect(res.skipped.length).toBe(0);
  });
});
