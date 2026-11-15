// v0.45 transit lines on the map. The rail planners return one segment per
// station hop ("Kelana Jaya Line: KLCC → Ampang Park"), which drew a line
// that visibly stopped at every station. Here consecutive hops on the same
// line become one continuous ride, each ride gets its own colour (the feed's
// line colour, or a distinct fallback so a change of line always changes
// colour), and every change of line becomes a transfer point.
// Kept free of Leaflet so pages and tests can use it without the map engine.
import type { Route } from './mapTypes';

const TRANSIT = new Set(['train', 'metro', 'transit', 'intercity', 'bus', 'tram', 'monorail', 'subway', 'rail']);
/** Fallback line colours when the feed has none — distinct from walk teal and taxi orange. */
const PALETTE = ['#2557E8', '#D92D20', '#7A5AF8', '#039855', '#C11574', '#B54708'];

export interface Ride extends Route { line: string; stops: number }
export interface Transfer { at: [number, number]; from: string; to: string; color: string; walk: boolean }

/** "Kelana Jaya Line: KLCC → Ampang Park" → "Kelana Jaya Line". */
export const lineOf = (r: Pick<Route, 'mode' | 'label'>) =>
  TRANSIT.has(r.mode) && r.label?.includes(': ') ? r.label.slice(0, r.label.indexOf(': ')) : null;

const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 0.0005;
const ends = (label: string | undefined) => {
  const tail = label?.split(': ').slice(1).join(': ') ?? '';
  const [from, to] = tail.split(' → ');
  return { from: from ?? '', to: to ?? '' };
};

/**
 * Join consecutive hops on one line into a single ride, colour each ride,
 * and list where the traveller changes line. Non-transit routes pass through.
 */
export function mergeTransit(routes: Route[]): { routes: (Route | Ride)[]; transfers: Transfer[] } {
  const out: (Route | Ride)[] = [];
  const palette = new Map<string, string>();
  for (const r of routes) {
    const line = lineOf(r);
    const prev = out.at(-1) as Ride | undefined;
    if (line && prev && 'line' in prev && prev.line === line && prev.mode === r.mode
      && r.points.length && prev.points.length && near(prev.points.at(-1)!, r.points[0])) {
      prev.points = [...prev.points, ...r.points.slice(1)];
      prev.stops += 1;
      prev.label = `${line}: ${ends(prev.label).from} → ${ends(r.label).to}`;
      continue;
    }
    out.push(line ? { ...r, points: [...r.points], line, stops: 1 } : r);
  }

  // Colour: the feed's own line colour, else a fallback unique to the line.
  // Two different lines in a row never share a colour, so a change is visible.
  const rides = out.filter((r): r is Ride => 'line' in r);
  let last: Ride | undefined;
  for (const ride of rides) {
    let color = ride.color ?? palette.get(ride.line);
    if (!color) color = PALETTE[palette.size % PALETTE.length];
    if (last && last.line !== ride.line && last.color?.toLowerCase() === color.toLowerCase()) {
      color = PALETTE.find(c => c.toLowerCase() !== last!.color?.toLowerCase() && ![...palette.values()].includes(c)) ?? PALETTE[(PALETTE.indexOf(color) + 1) % PALETTE.length];
    }
    palette.set(ride.line, color);
    ride.color = color;
    last = ride;
  }

  const transfers: Transfer[] = [];
  for (let i = 1; i < rides.length; i++) {
    const a = rides[i - 1], b = rides[i];
    if (a.line === b.line && near(a.points.at(-1)!, b.points[0])) continue;
    transfers.push({ at: b.points[0], from: a.line, to: b.line, color: b.color!, walk: !near(a.points.at(-1)!, b.points[0]) });
  }
  return { routes: out, transfers };
}

/** Line name → colour for the written directions, matching the map. */
export function lineColors(routes: Route[] | undefined) {
  const map = new Map<string, { color: string; stops: number }[]>();
  for (const r of mergeTransit(routes ?? []).routes) {
    if (!('line' in r)) continue;
    map.set(r.line, [...(map.get(r.line) ?? []), { color: r.color!, stops: r.stops }]);
  }
  return map;
}
