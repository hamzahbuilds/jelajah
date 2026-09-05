// Dashboard series math (spec Addendum 4). Pure; all days are UTC calendar
// days ("YYYY-MM-DD") to match usage_daily's date('now') buckets.

export function lastNDaysUtc(n: number, today: Date = new Date()): { start: string; end: string } {
  const end = today.toISOString().slice(0, 10);
  const s = new Date(today); s.setUTCDate(s.getUTCDate() - (n - 1));
  return { start: s.toISOString().slice(0, 10), end };
}

export function fillDays(rows: Array<{ day: string; n: number }>, start: string, end: string): Array<{ day: string; n: number }> {
  const byDay = new Map(rows.map(r => [r.day, r.n]));
  const out: Array<{ day: string; n: number }> = [];
  const d = new Date(start + 'T00:00:00Z');
  const stop = new Date(end + 'T00:00:00Z');
  while (d <= stop && out.length < 400) {
    const day = d.toISOString().slice(0, 10);
    out.push({ day, n: byDay.get(day) ?? 0 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** % change to 1 dp; null when there is no previous baseline. */
export function trendPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
