// Calendar-day helpers. A "day" in Jelajah is always a plain YYYY-MM-DD string —
// never an instant — so all conversions here stay in the LOCAL calendar.
//
// The trap this file exists to close: `new Date('2026-11-29T00:00:00')` parses as
// local midnight, so `.toISOString().slice(0, 10)` re-projects it into UTC and
// yields '2026-11-28' anywhere east of Greenwich. Malaysia is UTC+8, so every
// plan day rendered one day early (and the day list grew a phantom extra day).
// Use ymd() instead of toISOString() for any Date that represents a calendar day.

/** Local calendar date of `d` as YYYY-MM-DD (never shifts across timezones). */
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Today in the viewer's own timezone, as YYYY-MM-DD. */
export function todayYmd(now: Date = new Date()): string {
  return ymd(now);
}

/** Inclusive list of calendar days from `start` to `end` (both YYYY-MM-DD). */
export function daysBetween(start: string, end: string, max = 90): string[] {
  const out: string[] = [];
  const d = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  if (isNaN(d.getTime()) || isNaN(e.getTime())) return out;
  while (d <= e && out.length < max) {
    out.push(ymd(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
