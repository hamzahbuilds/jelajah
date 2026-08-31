// Client-side geo helpers: Photon geocoding (with Nominatim fallback) and
// Overpass nearest-station lookup. All free, no keys; results are cached server-side.
import { haversine } from '../shared/fares';

export interface GeoResult { name: string; lat: number; lng: number }

export async function geocode(q: string, bias?: { lat: number; lng: number }): Promise<GeoResult[]> {
  const qs = new URLSearchParams({ q, limit: '5' });
  if (bias) { qs.set('lat', String(bias.lat)); qs.set('lon', String(bias.lng)); }
  try {
    const res = await fetch(`https://photon.komoot.io/api/?${qs}`);
    if (res.ok) {
      const data: any = await res.json();
      const out = (data.features ?? []).map((f: any) => ({
        name: [f.properties.name, f.properties.city ?? f.properties.county, f.properties.country]
          .filter(Boolean).join(', '),
        lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
      }));
      if (out.length) return out;
    }
  } catch { /* fall through */ }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`);
    const data: any = await res.json();
    return data.map((r: any) => ({
      name: r.display_name.split(',').slice(0, 2).join(','),
      lat: Number(r.lat), lng: Number(r.lon),
    }));
  } catch { return []; }
}

export interface Station { name: string; lat: number; lng: number; distM: number; lines?: string }

/** 3 nearest railway/subway stations within 1.6 km via Overpass (free OSM query engine). */
export async function nearestStations(lat: number, lng: number): Promise<Station[]> {
  const query = `[out:json][timeout:10];
    node(around:1600,${lat},${lng})["railway"~"^(station|halt)$"];
    out body 20;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const stations: Station[] = (data.elements ?? [])
      .filter((e: any) => e.tags?.name || e.tags?.['name:en'])
      .map((e: any) => ({
        name: e.tags['name:en'] ?? e.tags.name,
        lat: e.lat, lng: e.lon,
        distM: Math.round(haversine(lat, lng, e.lat, e.lon)),
        lines: [e.tags.operator, e.tags.line].filter(Boolean).join(' · ') || undefined,
      }))
      .sort((a: Station, b: Station) => a.distM - b.distM);
    // de-duplicate same-named stations (multiple platforms)
    const seen = new Set<string>();
    return stations.filter(s => (seen.has(s.name) ? false : (seen.add(s.name), true))).slice(0, 3);
  } catch { return []; }
}

export const walkMinutes = (distM: number) => Math.max(1, Math.round((distM / 1000) * 1.3 * 12));
