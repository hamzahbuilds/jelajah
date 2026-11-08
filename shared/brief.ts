// v0.36 Trip brief (docs/23): where / when / who before Plan with AI.
// Shared by the client (wizard, chips, ticket) and the server (validation,
// prompt block, cache key). Plain data, no React.

export const BRIEF_LIMITS = { countries: 5, areas: 8, minDays: 1, maxDays: 30, people: 20, interests: 9 };

export const INTERESTS = ['food', 'nature', 'culture', 'shopping', 'themeparks', 'beaches', 'nightlife', 'halal', 'photo'] as const;
export type Interest = typeof INTERESTS[number];
export type Pace = 'relaxed' | 'balanced' | 'packed';

export interface BriefPlace { country: string; areas: string[] }
export type BriefWhen =
  | { kind: 'dates'; start: string; end: string }
  | { kind: 'month'; month: string; days: number }
  | { kind: 'unsure'; days: number };

export interface TripBrief {
  places: BriefPlace[];
  when: BriefWhen | null;
  party?: { adults: number; kids: number; seniors: number };
  pace?: Pace;
  interests?: Interest[];
  from?: string;
}

export const emptyBrief = (): TripBrief => ({ places: [], when: null });

/** ISO-3166 alpha-2 codes (UN members + common travel destinations). Names come from Intl.DisplayNames. */
export const COUNTRY_CODES = (
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI ' +
  'NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL ' +
  'TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'
).split(' ');
const CODE_SET = new Set(COUNTRY_CODES);
export const isCountry = (c: unknown): c is string => typeof c === 'string' && CODE_SET.has(c.toUpperCase());

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const clipStr = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** Days in an inclusive YYYY-MM-DD range (UTC arithmetic, no time zones). */
export function rangeDays(start: string, end: string): number {
  const a = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  const b = Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10));
  return Math.round((b - a) / 86400000) + 1;
}

/** Validate anything that claims to be a brief. Unknown fields are dropped; returns null when there's nothing usable. */
export function cleanBrief(raw: unknown): TripBrief | null {
  if (!raw || typeof raw !== 'object') return null;
  const r: any = raw;
  const seen = new Set<string>();
  const places: BriefPlace[] = [];
  for (const p of Array.isArray(r.places) ? r.places : []) {
    const code = typeof p?.country === 'string' ? p.country.toUpperCase() : '';
    if (!CODE_SET.has(code) || seen.has(code)) continue;
    seen.add(code);
    const areas = [...new Set((Array.isArray(p.areas) ? p.areas : []).map((a: unknown) => clipStr(a, 60)).filter(Boolean))] as string[];
    places.push({ country: code, areas: areas.slice(0, BRIEF_LIMITS.areas) });
    if (places.length >= BRIEF_LIMITS.countries) break;
  }
  let when: BriefWhen | null = null;
  const w = r.when;
  if (w?.kind === 'dates' && YMD.test(w.start) && YMD.test(w.end) && w.end >= w.start
    && rangeDays(w.start, w.end) <= BRIEF_LIMITS.maxDays) when = { kind: 'dates', start: w.start, end: w.end };
  else if (w?.kind === 'month' && YM.test(w.month)) when = { kind: 'month', month: w.month, days: clampInt(w.days, 1, BRIEF_LIMITS.maxDays, 3) };
  else if (w?.kind === 'unsure') when = { kind: 'unsure', days: clampInt(w.days, 1, BRIEF_LIMITS.maxDays, 3) };

  const b: TripBrief = { places, when };
  if (r.party && typeof r.party === 'object') {
    const party = {
      adults: clampInt(r.party.adults, 0, BRIEF_LIMITS.people, 0),
      kids: clampInt(r.party.kids, 0, BRIEF_LIMITS.people, 0),
      seniors: clampInt(r.party.seniors, 0, BRIEF_LIMITS.people, 0),
    };
    if (party.adults + party.kids + party.seniors > 0) b.party = party;
  }
  if (r.pace === 'relaxed' || r.pace === 'balanced' || r.pace === 'packed') b.pace = r.pace;
  const interests = (Array.isArray(r.interests) ? r.interests : []).filter((x: unknown) => (INTERESTS as readonly unknown[]).includes(x));
  if (interests.length) b.interests = [...new Set(interests)] as Interest[];
  const from = clipStr(r.from, 60);
  if (from) b.from = from;
  return places.length || when || b.party || b.pace || b.interests || b.from ? b : null;
}

/** Number of days the brief asks for, or null when it doesn't say. */
export function briefDays(b: TripBrief | null | undefined): number | null {
  const w = b?.when;
  if (!w) return null;
  return w.kind === 'dates' ? rangeDays(w.start, w.end) : w.days;
}

const INTEREST_EN: Record<Interest, string> = {
  food: 'food', nature: 'nature', culture: 'culture & history', shopping: 'shopping', themeparks: 'theme parks',
  beaches: 'beaches', nightlife: 'nightlife', halal: 'halal-friendly food only', photo: 'photo spots',
};

/**
 * The TRIP BRIEF block for the planner prompt. `countryName` maps codes to
 * names (the server passes an English Intl.DisplayNames).
 */
export function briefPromptBlock(b: TripBrief, countryName: (code: string) => string): string {
  const lines: string[] = ['TRIP BRIEF (the user filled this in; follow it):'];
  if (b.places.length) {
    lines.push('- Where: ' + b.places.map(p => `${countryName(p.country)} (${p.country})${p.areas.length ? ` — areas: ${p.areas.join(', ')}` : ''}`).join('; '));
    lines.push('  Stay within these countries and areas unless the user asks otherwise. With several areas, order them to minimise travel.');
  }
  const w = b.when;
  if (w?.kind === 'dates') lines.push(`- When: ${w.start} to ${w.end} (${rangeDays(w.start, w.end)} days). Make exactly that many days; mind the season, weather and weekday closures on those dates.`);
  else if (w?.kind === 'month') lines.push(`- When: sometime in ${w.month}, ${w.days} days. Make exactly ${w.days} days; mind that month's season and weather.`);
  else if (w?.kind === 'unsure') lines.push(`- When: dates not decided. Make exactly ${w.days} days.`);
  if (b.party) {
    const p = b.party;
    const who = [p.adults && `${p.adults} adult${p.adults > 1 ? 's' : ''}`, p.kids && `${p.kids} kid${p.kids > 1 ? 's' : ''}`, p.seniors && `${p.seniors} senior${p.seniors > 1 ? 's' : ''}`].filter(Boolean).join(', ');
    lines.push(`- Who: ${who}.${p.kids ? ' Keep it kid-friendly (rest breaks, early evenings).' : ''}${p.seniors ? ' Limit long walks and stairs.' : ''}`);
  }
  if (b.pace) lines.push(`- Pace: ${b.pace} (${b.pace === 'relaxed' ? '2–3 stops a day, late starts' : b.pace === 'packed' ? '6+ stops a day' : '4–5 stops a day'}).`);
  if (b.interests?.length) lines.push(`- Interests: ${b.interests.map(i => INTEREST_EN[i]).join(', ')}.`);
  if (b.from) lines.push(`- Travelling from: ${b.from}. Keep day 1 and the last day light for arrival and departure.`);
  return lines.join('\n');
}
