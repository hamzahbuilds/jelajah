// v0.31 MCP v2 geocoding (docs/19 §2.2).
//
// Why this exists: the old MCP geocoder sent only `q` to Photon with limit=1 —
// "Sensoji" resolved to a Sensoji in Lima, Peru. Every lookup is now biased to
// the trip's area, only accepted when it lands near that area, falls back to
// Nominatim, and is cached so repeat places (hotels, stations) are free and
// batches stay inside the public geocoders' fair-use limits.
import type { Env } from '../env.d';
import { haversine } from '../../shared/fares';

export interface LatLng { lat: number; lng: number }
/** A trip's area: a centre (for search bias) plus every known anchor point. A trip can span
 *  several cities ("Tokyo & Osaka"), so "near the trip" means near ANY anchor, not the centre. */
export interface TripArea extends LatLng { anchors: LatLng[] }
/** `kind` is the OpenStreetMap feature type, e.g. "railway=station", "highway=bus_stop". */
export interface Candidate extends LatLng { name: string; address: string; kind: string | null; distance_km: number | null }
export interface GeoResult { hit: Candidate | null; candidates: Candidate[]; reason?: string }

/** Max distance from the trip's centre for an automatic pin (Tokyo ↔ Osaka/Nara day trips fit). */
export const MAX_KM_FROM_TRIP = 300;
/** Two in-range matches further apart than this make a query ambiguous. */
export const AMBIGUOUS_SPREAD_KM = 25;

export const GEOCODE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS geocode_cache (
    query TEXT NOT NULL, cell TEXT NOT NULL, payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (query, cell))`,
];
let schemaReady = false;
export async function ensureGeocodeSchema(env: Env) {
  if (schemaReady) return;
  for (const sql of GEOCODE_SCHEMA) await env.DB.prepare(sql).run();
  schemaReady = true;
}

export const validLatLng = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

const km = (a: LatLng, b: LatLng) => haversine(a.lat, a.lng, b.lat, b.lng) / 1000;

/**
 * The trip's area. Anchors = its pinned activities and bookings (one per ~0.5° cell) plus each
 * place named in the destination ("Tokyo & Osaka, Japan" → Tokyo, Osaka, Japan; geocoded once,
 * cached). Centre = median of the anchors — the median so one stray pin (a home airport) can't
 * drag it into the sea. Null when nothing is known.
 */
export async function tripCenter(env: Env, tripId: number, fetcher: typeof fetch = fetch): Promise<TripArea | null> {
  const pts = await env.DB.prepare(
    `SELECT lat, lng FROM activities WHERE trip_id = ? AND lat IS NOT NULL AND lng IS NOT NULL
     UNION ALL SELECT lat, lng FROM expenses WHERE trip_id = ? AND lat IS NOT NULL AND lng IS NOT NULL`,
  ).bind(tripId, tripId).all<any>();
  const pinned: LatLng[] = (pts.results ?? []).filter((p: any) => validLatLng(p.lat, p.lng)).map((p: any) => ({ lat: p.lat, lng: p.lng }));

  const anchors: LatLng[] = [];
  const seen = new Set<string>();
  const add = (p: LatLng) => {
    const key = `${Math.round(p.lat * 2)},${Math.round(p.lng * 2)}`;
    if (!seen.has(key) && anchors.length < 30) { seen.add(key); anchors.push(p); }
  };
  pinned.forEach(add);

  const trip = await env.DB.prepare('SELECT destination FROM trips WHERE id = ?').bind(tripId).first<any>();
  const parts = String(trip?.destination ?? '').split(/\s*(?:&|,|\/|\band\b|\bdan\b)\s*/i).map(x => x.trim()).filter(x => x.length > 1).slice(0, 4);
  for (const part of parts) {
    try {
      const r = await geocode(env, part, null, fetcher);
      if (r.candidates[0]) add({ lat: r.candidates[0].lat, lng: r.candidates[0].lng });
    } catch { /* destination hints are optional */ }
  }
  if (!anchors.length) return null;
  const base = pinned.length ? pinned : anchors;
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  return { lat: med(base.map(p => p.lat)), lng: med(base.map(p => p.lng)), anchors };
}

const norm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
// ~1° cells: the same query near the same trip area shares a cache entry.
const cellOf = (c: LatLng | null) => (c ? `${Math.round(c.lat)},${Math.round(c.lng)}` : '-');

async function photon(env: Env, q: string, center: LatLng | null, fetcher: typeof fetch): Promise<Omit<Candidate, 'distance_km'>[]> {
  const u = new URL(env.GEOCODER_URL || 'https://photon.komoot.io/api/');
  u.searchParams.set('q', q);
  u.searchParams.set('limit', '5');
  u.searchParams.set('lang', 'en');
  if (center) {
    u.searchParams.set('lat', String(center.lat));
    u.searchParams.set('lon', String(center.lng));
    u.searchParams.set('location_bias_scale', '0.2');
    u.searchParams.set('zoom', '10');
  }
  const res = await fetcher(u.toString(), { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Jelajah trip planner' } });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const data: any = await res.json();
  return (data.features ?? []).map((f: any) => {
    const p = f.properties ?? {};
    return {
      name: String(p.name ?? q),
      address: [p.street && p.housenumber ? `${p.housenumber} ${p.street}` : p.street, p.district, p.city ?? p.county, p.state, p.country]
        .filter(Boolean).join(', '),
      lat: Number(f.geometry?.coordinates?.[1]), lng: Number(f.geometry?.coordinates?.[0]),
      kind: p.osm_key && p.osm_value ? `${p.osm_key}=${p.osm_value}` : null,
    };
  }).filter((c: any) => validLatLng(c.lat, c.lng));
}

async function nominatim(q: string, center: LatLng | null, fetcher: typeof fetch): Promise<Omit<Candidate, 'distance_km'>[]> {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', q);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', '5');
  u.searchParams.set('accept-language', 'en');
  if (center) {
    const d = 3; // ~300 km box, a preference not a filter (bounded=0)
    u.searchParams.set('viewbox', `${center.lng - d},${center.lat + d},${center.lng + d},${center.lat - d}`);
  }
  const res = await fetcher(u.toString(), { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Jelajah trip planner (self-hosted)' } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const data: any[] = await res.json();
  return data.map(r => ({
    name: String(r.name || String(r.display_name ?? q).split(',')[0]),
    address: String(r.display_name ?? ''),
    lat: Number(r.lat), lng: Number(r.lon),
    kind: r.category && r.type ? `${r.category}=${r.type}` : null,
  })).filter(c => validLatLng(c.lat, c.lng));
}

// "Ohanajaya Station" / "Ohanajaya Sta." / "お花茶屋駅" / "Stesen KL Sentral" — the user means the station.
const STATION_QUERY = /\bstation\b|\bsta\.?(?=\s|$)|駅|站|역|\bstesen\b|\bbahnhof\b|\bgare\b/i;
const STATION_KIND = /^(railway=(station|halt|stop)|public_transport=station|building=(train_station|transportation))$/;
const kindRank = (c: { kind: string | null }) =>
  c.kind && STATION_KIND.test(c.kind) ? (c.kind.startsWith('railway=station') || c.kind.startsWith('public_transport') ? 0 : 1) : 2;

/**
 * Geocode `q` near `center`. `hit` is set only when a candidate lies within
 * MAX_KM_FROM_TRIP of the centre (or there is no centre and exactly one clear
 * result) — otherwise the caller gets candidates to choose from, never a guess.
 */
export async function geocode(env: Env, q: string, center: LatLng | TripArea | null, fetcher: typeof fetch = fetch): Promise<GeoResult> {
  const query = norm(q);
  if (!query) return { hit: null, candidates: [], reason: 'empty query' };
  await ensureGeocodeSchema(env).catch(() => { /* cache is optional */ });
  const cell = cellOf(center);

  let raw: Omit<Candidate, 'distance_km'>[] | null = null;
  try {
    const cached = await env.DB.prepare('SELECT payload FROM geocode_cache WHERE query = ? AND cell = ?').bind(query, cell).first<any>();
    if (cached) raw = JSON.parse(cached.payload);
  } catch { /* ignore cache errors */ }

  let reason: string | undefined;
  if (!raw) {
    try { raw = await photon(env, q, center, fetcher); } catch { raw = null; }
    if (!raw || raw.length === 0) {
      try { raw = await nominatim(q, center, fetcher); } catch { reason = 'geocoders unavailable'; raw = null; }
    }
    if (raw && raw.length) {
      env.DB.prepare('INSERT OR REPLACE INTO geocode_cache (query, cell, payload) VALUES (?,?,?)')
        .bind(query, cell, JSON.stringify(raw)).run().catch(() => { /* best effort */ });
    }
  }
  if (!raw || raw.length === 0) return { hit: null, candidates: [], reason: reason ?? 'no match found' };

  // Distance to the NEAREST anchor of the trip (a Tokyo & Osaka trip accepts both cities).
  const anchors: LatLng[] = center ? ('anchors' in center && center.anchors.length ? center.anchors : [center]) : [];
  let candidates: Candidate[] = raw.map(c => ({ ...c, kind: (c as any).kind ?? null, distance_km: anchors.length ? Math.round(Math.min(...anchors.map(a => km(a, c)))) : null }));
  // A station query should land on the station, not a bus stop, dentist or traffic light named
  // after it ("お花茶屋駅" → Photon's first hit was a bus stop ~100 m away). Stable sort keeps
  // the geocoder's order within each rank.
  if (STATION_QUERY.test(q) && candidates.some(c => kindRank(c) < 2)) {
    candidates = candidates.map((c, i) => ({ c, i })).sort((a, b) => kindRank(a.c) - kindRank(b.c) || a.i - b.i).map(x => x.c);
  }
  if (center) {
    const nearAll = candidates.filter(c => (c.distance_km ?? Infinity) <= MAX_KM_FROM_TRIP);
    const near = nearAll[0];
    // Two plausible matches far apart (a "Dotonbori" restaurant in Tokyo vs Dotonbori in Osaka)
    // is ambiguity, not a hit — don't guess; ask for the area instead.
    if (near && nearAll.some(c => km(near, c) > AMBIGUOUS_SPREAD_KM)) {
      return { hit: null, candidates, reason: `several places match "${q}" in different areas — add the area to the place (e.g. "${q}, <city>") or pass lat/lng` };
    }
    return near
      ? { hit: near, candidates }
      : { hit: null, candidates, reason: `no match within ${MAX_KM_FROM_TRIP} km of the trip's places` };
  }
  return candidates.length === 1 ? { hit: candidates[0], candidates } : { hit: null, candidates, reason: 'ambiguous without a trip area' };
}
