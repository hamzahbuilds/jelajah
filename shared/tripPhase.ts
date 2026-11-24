// Trip phases for the Home list (v0.49). Dates are local-calendar YYYY-MM-DD strings.
export interface TripDates { id: number; name: string; start_date?: string | null; end_date?: string | null }

// v0.49 Home: trips grouped by where they are in time, with a sort and a filter.
export type Phase = 'now' | 'upcoming' | 'undated' | 'done';
export type TripSort = 'date' | 'added' | 'name';
export const PHASES: Phase[] = ['now', 'upcoming', 'undated', 'done'];

export function phaseOf(tr: TripDates, today: string): Phase {
  if (!tr.start_date) return 'undated';
  const end = tr.end_date || tr.start_date;
  return today < tr.start_date ? 'upcoming' : today > end ? 'done' : 'now';
}

/** Trip date: soonest first, but finished trips newest first (last trip on top). */
export function sortTrips<T extends TripDates>(list: T[], sort: TripSort, phase: Phase, lang: string): T[] {
  const out = [...list];
  if (sort === 'name') return out.sort((a, b) => a.name.localeCompare(b.name, lang === 'ms' ? 'ms' : 'en', { sensitivity: 'base' }));
  if (sort === 'added' || phase === 'undated') return out.sort((a, b) => b.id - a.id);
  if (phase === 'done') return out.sort((a, b) => (b.end_date || b.start_date || '').localeCompare(a.end_date || a.start_date || ''));
  return out.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '') || a.id - b.id);
}

