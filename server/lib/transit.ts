// v0.40 Malaysia + Singapore public transport routing (docs/26).
//
// Networks are compiled by scripts/build-transit.py into server/data/transit/
// (one JSON module each, loaded the first time a route touches its area and
// kept for the isolate's life). A query loads every network whose box holds
// both points, then runs one Dijkstra across them:
//   - ride edges: the shortest observed (GTFS) or estimated (OSM) hop time;
//   - boarding: half the line's typical headway (capped at 15 min) whenever
//     the line changes, so a direct bus beats three quick changes;
//   - walking: from the start / to the end (<= 1 km) and between nearby stops
//     (<= 400 m, any network), at 1.2 m/s on a 1.3 street factor.
// Estimates, never timetables: the response says so, with its data credit.
import { loaders, manifest } from '../data/transit';
import { haversine } from '../../shared/fares';

type Point = [number, number];
type Mode = 'train' | 'bus';
interface Raw {
  id: string; name: string; kind: 'rail' | 'bus'; attribution: string; built: string;
  stops: number[]; names: string[]; lines: [string, string, string, Mode, number][];
  edges: number[]; shapes: string[];
}
interface Net {
  id: string; raw: Raw; lat: Float64Array; lon: Float64Array;
  out: number[][]; // per stop: indexes into raw.edges (step 5)
  grid: Map<string, number[]>;
}
interface Meta { id: string; kind: 'rail' | 'bus'; bbox: [number, number, number, number]; attribution: string; built: string }

const NETWORKS = (manifest as unknown as { networks: Meta[] }).networks;
const cache = new Map<string, Promise<Net>>();
const CELL = 0.005; // ~550 m
const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;

function prepare(raw: Raw): Net {
  const n = raw.names.length;
  const lat = new Float64Array(n), lon = new Float64Array(n);
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    lat[i] = raw.stops[i * 2] / 1e5; lon[i] = raw.stops[i * 2 + 1] / 1e5;
    const k = cellKey(lat[i], lon[i]);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  }
  const out: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < raw.edges.length; e += 5) out[raw.edges[e]].push(e);
  return { id: raw.id, raw, lat, lon, out, grid };
}

function load(id: string): Promise<Net> {
  let p = cache.get(id);
  if (!p) {
    p = loaders[id]().then(m => prepare(m.default as Raw));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

const PAD = 0.03;
const inBox = (b: Meta['bbox'], p: Point) => p[0] >= b[0] - PAD && p[0] <= b[2] + PAD && p[1] >= b[1] - PAD && p[1] <= b[3] + PAD;
/** Networks covering both points (rail only, or rail + bus). */
export function transitCoverage(from: Point, to: Point, railOnly: boolean): Meta[] {
  return NETWORKS.filter(m => (!railOnly || m.kind === 'rail') && inBox(m.bbox, from) && inBox(m.bbox, to));
}

function decode(str: string): Point[] {
  const pts: Point[] = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lon += d;
    }
    pts.push([lat / 1e5, lon / 1e5]);
  }
  return pts;
}

const WALK = 1.2, STREET = 1.3, ACCESS = 1000, TRANSFER = 400, MAX_WAIT = 900;
const dist = (a: Point, b: Point) => haversine(a[0], a[1], b[0], b[1]);

export interface TransitStep { line: string; fromStation: string; toStation: string; duration: number; mode: Mode }

/**
 * Best estimated public-transport route between two points over the networks
 * that cover both. `railOnly` keeps to trains (LRT/MRT/KTM/monorail).
 */
export async function transitRoute(from: Point, to: Point, railOnly: boolean) {
  const unavailable = { available: false as const, reason: 'transit_coverage' };
  const metas = transitCoverage(from, to, railOnly);
  if (!metas.length) return unavailable;
  const nets = await Promise.all(metas.map(m => load(m.id)));
  // Global node id = offset[net] + stop.
  const offset: number[] = []; let total = 0;
  for (const n of nets) { offset.push(total); total += n.raw.names.length; }
  const netOf = (g: number) => { let k = 0; while (k + 1 < nets.length && offset[k + 1] <= g) k++; return k; };
  const pos = (g: number): Point => { const k = netOf(g), i = g - offset[k]; return [nets[k].lat[i], nets[k].lon[i]]; };
  const near = (p: Point, radius: number) => {
    const found: { g: number; d: number }[] = [];
    const span = Math.ceil(radius / 550);
    const cy = Math.floor(p[0] / CELL), cx = Math.floor(p[1] / CELL);
    nets.forEach((n, k) => {
      for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) {
        for (const i of n.grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
          const d = dist(p, [n.lat[i], n.lon[i]]);
          if (d <= radius) found.push({ g: offset[k] + i, d });
        }
      }
    });
    return found.sort((a, b) => a.d - b.d);
  };
  const starts = near(from, ACCESS).slice(0, 40), ends = near(to, ACCESS).slice(0, 40);
  if (!starts.length || !ends.length) return unavailable;
  const endWalk = new Map(ends.map(e => [e.g, e.d * STREET / WALK]));

  const cost = new Float64Array(total).fill(Infinity);
  const line = new Int32Array(total).fill(-2); // -1 walked here, -2 unset; else global line id
  const prevNode = new Int32Array(total).fill(-1);
  const prevEdge = new Int32Array(total).fill(-1); // raw edge index in its net, -1 = walk
  const lineBase: number[] = []; let lines = 0;
  for (const n of nets) { lineBase.push(lines); lines += n.raw.lines.length; }
  const heap: [number, number][] = [];
  const push = (v: [number, number]) => { let i = heap.length; heap.push(v); while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= v[0]) break; heap[i] = heap[p]; i = p; } heap[i] = v; };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { let i = 0; for (;;) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= last[0]) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return top; };
  for (const s of starts) {
    const c = s.d * STREET / WALK;
    if (c < cost[s.g]) { cost[s.g] = c; line[s.g] = -1; push([c, s.g]); }
  }
  let best = Infinity, bestEnd = -1;
  let settled = 0;
  while (heap.length) {
    const [c, u] = pop();
    if (c !== cost[u]) continue;
    if (c >= best) break;
    if (++settled > 60000) break; // bound work on huge merged areas
    const ew = endWalk.get(u);
    if (ew !== undefined && line[u] >= 0 && c + ew < best) { best = c + ew; bestEnd = u; }
    const k = netOf(u), n = nets[k], i = u - offset[k];
    for (const e of n.out[i]) {
      const r = n.raw.edges, gl = lineBase[k] + r[e + 2], hw = n.raw.lines[r[e + 2]][4];
      const board = line[u] === gl ? 0 : Math.min(hw / 2, MAX_WAIT);
      const v = offset[k] + r[e + 1], next = c + board + r[e + 3];
      if (next < cost[v]) { cost[v] = next; line[v] = gl; prevNode[v] = u; prevEdge[v] = e; push([next, v]); }
    }
    if (line[u] >= 0) { // one walking transfer after a ride, to stops nearby (any network)
      const p = pos(u);
      for (const t of near(p, TRANSFER)) {
        if (t.g === u) continue;
        const next = c + t.d * STREET / WALK + 60;
        if (next < cost[t.g]) { cost[t.g] = next; line[t.g] = -1; prevNode[t.g] = u; prevEdge[t.g] = -1; push([next, t.g]); }
      }
    }
  }
  if (bestEnd < 0) return unavailable;

  // Walk back the path.
  const path: { g: number; from: number; e: number }[] = [];
  for (let v = bestEnd; prevNode[v] >= 0; v = prevNode[v]) path.unshift({ g: v, from: prevNode[v], e: prevEdge[v] });
  const first = path.length ? path[0].from : bestEnd;
  const nameOf = (g: number) => { const k = netOf(g); return nets[k].raw.names[g - offset[k]]; };
  const segments: { points: Point[]; mode: Mode; label: string; color?: string }[] = [];
  const connections: { from: Point; to: Point; label: string }[] = [{ from, to: pos(first), label: nameOf(first) }];
  const steps: TransitStep[] = [];
  let lastLine = -1, rideSeconds = 0, rideDistance = 0;
  const used = new Set<string>();
  for (const s of path) {
    if (s.e < 0) { connections.push({ from: pos(s.from), to: pos(s.g), label: nameOf(s.g) }); lastLine = -1; continue; }
    const k = netOf(s.g), n = nets[k], r = n.raw.edges, li = r[s.e + 2], L = n.raw.lines[li];
    used.add(n.id);
    const pts = r[s.e + 4] >= 0 ? decode(n.raw.shapes[r[s.e + 4]]) : [pos(s.from), pos(s.g)];
    const colour = /^[0-9A-F]{6}$/i.test(L[2]) ? `#${L[2]}` : undefined;
    const label = L[1] && L[1] !== L[0] ? `${L[0]} ${L[1]}` : L[0];
    segments.push({ points: pts, mode: L[3], label: `${label}: ${nameOf(s.from)} → ${nameOf(s.g)}`, color: colour });
    rideSeconds += r[s.e + 3];
    rideDistance += pts.slice(1).reduce((d, p, j) => d + dist(pts[j], p), 0);
    const gl = lineBase[k] + li;
    if (gl === lastLine && steps.length) { steps[steps.length - 1].toStation = nameOf(s.g); steps[steps.length - 1].duration += r[s.e + 3]; }
    else steps.push({ line: label, fromStation: nameOf(s.from), toStation: nameOf(s.g), duration: r[s.e + 3], mode: L[3] });
    lastLine = gl;
  }
  if (!steps.length) return unavailable;
  connections.push({ from: pos(bestEnd), to, label: nameOf(bestEnd) });
  const walkDistance = connections.reduce((d, w) => d + dist(w.from, w.to) * STREET, 0);
  const usedMeta = metas.filter(m => used.has(m.id));
  const hasBus = steps.some(s => s.mode === 'bus');
  return {
    available: true as const, mode: hasBus ? 'transit' : 'train', segments, connections,
    duration: Math.round(best), distance: Math.round(rideDistance + walkDistance),
    railSeconds: rideSeconds, railDistance: Math.round(rideDistance), estimated: true, steps,
    source: 'my-sg-transit', networks: usedMeta.map(m => m.id),
    attribution: [...new Set(usedMeta.map(m => m.attribution))].join(' · '),
    dataDate: usedMeta.map(m => m.built).sort()[0],
    lines: [...new Set(steps.map(s => s.line))],
    stations: [steps[0].fromStation, ...steps.map(s => s.toStation)],
  };
}
