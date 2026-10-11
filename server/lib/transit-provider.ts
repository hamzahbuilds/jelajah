/** MOTIS v6 adapter. No public endpoint is enabled implicitly. */
export function decodeTransitPolyline(encoded: string, precision: number): [number, number][] {
  if (typeof encoded !== 'string' || encoded.length > 400000 || !Number.isInteger(precision) || precision < 0 || precision > 7) throw new Error('geometry');
  let index = 0, lat = 0, lng = 0;
  const read = () => {
    let value = 0, shift = 0, byte;
    do {
      if (index >= encoded.length || shift > 50) throw new Error('geometry');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('geometry');
      value += (byte % 32) * 2 ** shift; shift += 5;
    } while (byte >= 32);
    return value % 2 ? -(Math.floor(value / 2) + 1) : value / 2;
  };
  const points: [number, number][] = [];
  while (index < encoded.length) {
    lat += read(); lng += read();
    const p: [number, number] = [lat / 10 ** precision, lng / 10 ** precision];
    if (Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180 || points.length > 30000) throw new Error('geometry');
    points.push(p);
  }
  return points;
}

const text = (v: unknown) => typeof v === 'string' ? v.slice(0, 250) : '';
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
export interface TransitOption {
  id: string; departure: string; arrival: string; duration: number; transfers: number | null;
  segments: { points: [number,number][]; mode: string; label: string; color?: string }[];
  fareProducts: { name: string; amount: number; currency: string }[];
  legs: { mode: string; line: string; from: string; to: string; departure: string; arrival: string; realTime: boolean }[];
}
export function normalizeTransitOptions(data: any): TransitOption[] {
  if (!Array.isArray(data?.itineraries)) throw new Error('response');
  return data.itineraries.slice(0, 5).flatMap((it: any, index: number) => {
    if (!Array.isArray(it.legs) || !it.legs.length || it.legs.length > 50 || !date(it.startTime) || !date(it.endTime) || !Number.isFinite(it.duration) || it.duration <= 0) return [];
    if (it.legs.some((l: any) => l.cancelled) || !it.legs.some((l: any) => !['WALK', 'BIKE', 'CAR'].includes(l.mode))) return [];
    const segments = it.legs.flatMap((leg: any) => {
      const points = decodeTransitPolyline(leg.legGeometry?.points ?? '', leg.legGeometry?.precision ?? 6);
      return points.length > 1 ? [{ points, mode: leg.mode === 'WALK' ? 'walk' : 'transit',
        label: `${text(leg.displayName || leg.routeShortName || leg.mode)}: ${text(leg.from?.name)} → ${text(leg.to?.name)}`,
        color: /^[a-f0-9]{6}$/i.test(leg.routeColor) ? `#${leg.routeColor}` : undefined }] : [];
    });
    // Ticket products are alternatives (adult/child/pass/discount), not additive prices.
    // Preserve their names and currency; never invent a whole-journey total.
    const products: { name: string; amount: number; currency: string }[] = [];
    const visit = (value: any, depth = 0) => {
      if (depth > 8 || products.length >= 40 || value == null) return;
      if (Array.isArray(value)) { value.forEach(v => visit(v, depth + 1)); return; }
      if (typeof value !== 'object') return;
      if (typeof value.name === 'string' && Number.isFinite(value.amount) && /^[A-Z]{3}$/.test(value.currency)) products.push({ name: text(value.name), amount: value.amount, currency: value.currency });
      else for (const key of ['transferProducts', 'effectiveFareLegProducts']) visit(value[key], depth + 1);
    };
    visit(it.fareTransfers);
    return [{ id: String(index), departure: it.startTime, arrival: it.endTime, duration: it.duration,
      transfers: Number.isInteger(it.transfers) && it.transfers >= 0 ? it.transfers : null,
      segments, fareProducts: products.filter((p, i) => products.findIndex(v => JSON.stringify(v) === JSON.stringify(p)) === i),
      legs: it.legs.map((leg: any) => ({ mode: text(leg.mode), line: text(leg.displayName || leg.routeShortName),
        from: text(leg.from?.name), to: text(leg.to?.name), departure: text(leg.startTime), arrival: text(leg.endTime), realTime: leg.realTime === true })),
    }];
  });
}
