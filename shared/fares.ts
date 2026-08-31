// Transport mode recommendation + fare/duration estimates for Japan city travel.
// All fares are ESTIMATES (Japan fares are gate-to-gate); the UI must badge them "≈"
// and always allow overriding the mode and logging the actual fare.

export type Mode = 'walk' | 'train' | 'taxi' | 'intercity';

export interface LegEstimate {
  mode: Mode;
  recommended: boolean;
  fareJpy: number;      // per person; 0 for walk
  minutes: number;
}

const R = 6371e3;
/** Great-circle distance in metres. */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Tokyo/Osaka metro–JR style distance-banded fare (per person, one way). */
export function metroFareJpy(km: number): number {
  if (km <= 3) return 180;
  if (km <= 7) return 210;
  if (km <= 11) return 260;
  if (km <= 15) return 300;
  if (km <= 19) return 330;
  if (km <= 27) return 390;
  return 480; // up to ~40 km
}

/** Intercity rail rough estimate (ordinary reserved, per person). */
export function intercityFareJpy(km: number): number {
  return Math.round(km * 25);
}

/** Tokyo-style taxi meter: ¥500 first 1.096 km, then ¥100 per 255 m (whole cab, not per person). */
export function taxiFareJpy(km: number): number {
  if (km <= 1.096) return 500;
  return 500 + Math.ceil(((km - 1.096) * 1000) / 255) * 100;
}

export function estimates(distM: number): LegEstimate[] {
  const km = distM / 1000;
  // straight-line → street distance fudge
  const streetKm = km * 1.3;
  const walk: LegEstimate = { mode: 'walk', recommended: false, fareJpy: 0, minutes: Math.max(1, Math.round(streetKm * 12)) };
  const train: LegEstimate = {
    mode: km > 40 ? 'intercity' : 'train', recommended: false,
    fareJpy: km > 40 ? intercityFareJpy(km) : metroFareJpy(km),
    minutes: Math.round(km * 3 + 8),
  };
  const taxi: LegEstimate = { mode: 'taxi', recommended: false, fareJpy: taxiFareJpy(streetKm), minutes: Math.max(4, Math.round(streetKm * 2.5)) };
  let rec: Mode;
  if (km <= 1.0) rec = 'walk';
  else if (km <= 40) rec = 'train';
  else rec = 'intercity';
  const out = [walk, train, taxi];
  for (const e of out) e.recommended = e.mode === rec || (rec === 'intercity' && e.mode === 'intercity');
  return out;
}

export const MODE_ICON: Record<Mode, string> = { walk: '🚶', train: '🚇', taxi: '🚕', intercity: '🚄' };
