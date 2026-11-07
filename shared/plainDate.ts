// Calendar-date maths on 'YYYY-MM-DD' strings — no Date objects, no time zones.
//
// A trip day is a wall-calendar date, not an instant. Building a Date from a
// hand-made ISO string ('2026-11-29T00:00:00') parses in the device's zone and
// can shift a day across DST or when the phone travels. Everything here works
// on integer day numbers (days since 1970-01-01, proleptic Gregorian), using
// Howard Hinnant's days_from_civil / civil_from_days. Native Temporal would do
// the same job, but it's missing in Safari and the polyfill is ~15 KB for what
// is ~30 lines of integer arithmetic.

export type Ymd = string; // 'YYYY-MM-DD'

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isYmd(s: unknown): s is Ymd {
  if (typeof s !== 'string') return false;
  const m = RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Days since 1970-01-01 for a civil date. */
export function toDayNumber(s: Ymd): number {
  const m = RE.exec(s);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${s}`);
  let y = +m[1];
  const mo = +m[2], d = +m[3];
  y -= mo <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(z: number): Ymd {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const addDays = (s: Ymd, n: number): Ymd => fromDayNumber(toDayNumber(s) + n);

/** b − a in whole days (negative when b is before a). */
export const diffDays = (a: Ymd, b: Ymd): number => toDayNumber(b) - toDayNumber(a);

export const compare = (a: Ymd, b: Ymd): number => Math.sign(diffDays(b, a));

/** Nights in a stay: check-in 1 Dec, check-out 3 Dec = 2. */
export const nightsBetween = (checkIn: Ymd, checkOut: Ymd): number => diffDays(checkIn, checkOut);

/** Days in a trip, inclusive: 29 Nov → 7 Dec = 9. */
export const tripDays = (start: Ymd, end: Ymd): number => diffDays(start, end) + 1;

/** 0 = Monday … 6 = Sunday (ISO weekday − 1). 1970-01-01 was a Thursday. */
export const weekdayMon0 = (s: Ymd): number => ((toDayNumber(s) % 7) + 7 + 3) % 7;

export const parts = (s: Ymd) => ({ y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) });

export const ymdOf = (y: number, m: number, d: number): Ymd =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export const firstOfMonth = (s: Ymd): Ymd => s.slice(0, 8) + '01';

/** Same day-of-month clamped, n months later (Jan 31 + 1 → Feb 28/29). */
export function addMonths(s: Ymd, n: number): Ymd {
  const { y, m, d } = parts(s);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  return ymdOf(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/**
 * Month grid, Monday-first: the month's days padded with nulls so index % 7 is
 * the weekday column. Length is a multiple of 7.
 */
export function monthGrid(monthStart: Ymd): (Ymd | null)[] {
  const { y, m } = parts(monthStart);
  const first = ymdOf(y, m, 1);
  const lead = weekdayMon0(first);
  const n = daysInMonth(y, m);
  const cells: (Ymd | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= n; d++) cells.push(ymdOf(y, m, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Today in the device's calendar — the one place a Date is read, via its local fields. */
export function todayYmd(now: Date = new Date()): Ymd {
  return ymdOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Format for display without going through a zone-shifting Date parse: build
 * the Date from local fields at noon, which no DST transition can push to a
 * different calendar day.
 */
export function formatYmd(s: Ymd, locale: string, opts: Intl.DateTimeFormatOptions): string {
  const { y, m, d } = parts(s);
  return new Date(y, m - 1, d, 12).toLocaleDateString(locale, opts);
}
