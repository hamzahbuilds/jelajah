// Foreign-CSV mapping wizard transforms — pure and unit-testable.
// Handles day-table spreadsheets: merged/forward-filled day rows, time ranges,
// text "times" (meal notes), an Overnight/lodging column, and per-day budgets.

import { MONTHS, ymd } from './parsers/types';

export interface WizardMapping {
  dayNo?: number;        // column index of the day number (optional)
  date?: number;         // "Dec 8" style
  time?: number;         // "08:00" | "11:00–13:00" | text
  title: number;
  notes?: number[];      // extra columns merged into notes (e.g. Parking)
  overnight?: number;    // lodging column (day rows only)
  budgets?: Partial<Record<'transport' | 'accommodation' | 'food' | 'attractions' | 'misc' | 'total', number>>;
  budgetCurrency?: string; // default JPY
}

export interface WizardActivity {
  day: string; title: string;
  start_time: string | null; end_time: string | null;
  notes: string | null;
  isLodging?: boolean;
}

export interface WizardDayBudget {
  day: string; currency: string;
  transport?: number; accommodation?: number; food?: number;
  attractions?: number; misc?: number; total?: number;
}

export interface WizardResult {
  activities: WizardActivity[];
  budgets: WizardDayBudget[];
  skipped: Array<{ row: number; reason: string }>;
}

/** "Dec 8" + trip range → YYYY-MM-DD (year from the range, rolling over new year). */
export function resolveShortDate(s: string, rangeStart: string, rangeEnd: string): string | undefined {
  const m = s.trim().match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/) ?? s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})$/);
  if (!m) return undefined;
  const monTok = /^\d/.test(m[1]) ? m[2] : m[1];
  const dayTok = /^\d/.test(m[1]) ? m[1] : m[2];
  const mon = MONTHS[monTok.toLowerCase()];
  if (!mon) return undefined;
  const y1 = Number(rangeStart.slice(0, 4));
  const y2 = Number(rangeEnd.slice(0, 4));
  for (const y of [y1, y2]) {
    const d = ymd(y, mon, Number(dayTok));
    if (d >= rangeStart.slice(0, 10) && d <= rangeEnd.slice(0, 10)) return d;
  }
  return ymd(y1, mon, Number(dayTok)); // best effort
}

/** "11:00–13:00" | "8:00" | "~17:00" → {start,end}; non-times → null (text row). */
export function parseTimeCell(s: string): { start: string | null; end: string | null; isText: boolean } {
  const t = s.trim().replace(/[~≈]/g, '');
  const range = t.match(/^(\d{1,2}[:.]\d{2})\s*[–—-]\s*(\d{1,2}[:.]\d{2})$/);
  const norm = (x: string) => {
    const [h, m] = x.split(/[:.]/);
    return `${h.padStart(2, '0')}:${m}`;
  };
  if (range) return { start: norm(range[1]), end: norm(range[2]), isText: false };
  const single = t.match(/^(\d{1,2}[:.]\d{2})$/);
  if (single) return { start: norm(single[1]), end: null, isText: false };
  return { start: null, end: null, isText: t.length > 0 };
}

const num = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const m = String(s).replace(/[¥￥RM\s,]/gi, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

export function transformGrid(
  grid: string[][], mapping: WizardMapping,
  rangeStart: string, rangeEnd: string,
): WizardResult {
  const out: WizardResult = { activities: [], budgets: [], skipped: [] };
  let currentDay: string | undefined;
  const cell = (row: string[], i: number | undefined) => (i != null && i >= 0 ? (row[i] ?? '').trim() : '');

  grid.forEach((row, ri) => {
    if (ri === 0) return; // header
    // forward-fill the day from the date column
    const dateCell = cell(row, mapping.date);
    if (dateCell) {
      const resolved = resolveShortDate(dateCell, rangeStart, rangeEnd)
        ?? (/^\d{4}-\d{2}-\d{2}$/.test(dateCell) ? dateCell : undefined);
      if (resolved) currentDay = resolved;
      else out.skipped.push({ row: ri + 1, reason: `unreadable date "${dateCell}"` });
      // day rows also carry lodging + budgets
      if (currentDay) {
        const stay = cell(row, mapping.overnight).replace(/^[–—-]\s*$/, '');
        if (stay && stay !== '–') {
          out.activities.push({ day: currentDay, title: `🛏️ ${stay}`, start_time: null, end_time: null, notes: null, isLodging: true });
        }
        if (mapping.budgets) {
          const b: WizardDayBudget = { day: currentDay, currency: mapping.budgetCurrency ?? 'JPY' };
          let any = false;
          for (const k of ['transport', 'accommodation', 'food', 'attractions', 'misc', 'total'] as const) {
            const v = num(cell(row, mapping.budgets[k]));
            if (v != null) { b[k] = v; any = true; }
          }
          if (any) out.budgets.push(b);
        }
      }
    }
    if (!currentDay) { if (cell(row, mapping.title)) out.skipped.push({ row: ri + 1, reason: 'no day resolved yet' }); return; }

    const title = cell(row, mapping.title);
    if (!title) return;
    if (/^TOTALS?$/i.test(cell(row, mapping.dayNo)) || /^TOTALS?$/i.test(title)) return;
    const timeCell = cell(row, mapping.time);
    const t = parseTimeCell(timeCell);
    const noteParts = (mapping.notes ?? []).map(i => cell(row, i)).filter(v => v && v !== '–');
    if (t.isText) noteParts.unshift(timeCell); // e.g. "Halal/Pork-Free Meal" label
    out.activities.push({
      day: currentDay, title,
      start_time: t.start, end_time: t.end,
      notes: noteParts.length ? noteParts.join(' · ') : null,
    });
  });
  return out;
}
