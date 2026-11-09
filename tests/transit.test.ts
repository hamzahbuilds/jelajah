// v0.40 Malaysia + Singapore transit routing (docs/26), against the compiled networks.
import { describe, expect, it } from 'vitest';
import { transitCoverage, transitRoute } from '../server/lib/transit';

type P = [number, number];
const KLCC: P = [3.1579, 101.7123], MID_VALLEY: P = [3.1186, 101.6770], BATU_CAVES: P = [3.2379, 101.6840];
const CHANGI: P = [1.3572, 103.9884], ORCHARD: P = [1.3040, 103.8320];
const IPOH_STATION: P = [4.5975, 101.0748], IPOH_PARADE: P = [4.5951, 101.1136];
const KOMTAR: P = [5.4145, 100.3290], BATU_FERRINGHI: P = [5.4718, 100.2483];

const summary = (r: any) => r.available ? `${Math.round(r.duration / 60)} min · ${r.steps.map((s: any) => `${s.mode}:${s.line} ${s.fromStation}→${s.toStation}`).join(' | ')}` : r.reason;

describe('Malaysia + Singapore transit (v0.40)', () => {
  it('knows which networks cover a trip', () => {
    expect(transitCoverage(KLCC, MID_VALLEY, true).map(m => m.id)).toEqual(expect.arrayContaining(['my-klang-valley-rail', 'my-ktmb']));
    expect(transitCoverage(CHANGI, ORCHARD, false).map(m => m.id)).toEqual(expect.arrayContaining(['sg-rail', 'sg-bus']));
    expect(transitCoverage([35.68, 139.76], [35.66, 139.70], false)).toHaveLength(0); // Tokyo has its own router
  });

  it('Kuala Lumpur by rail: KLCC to Mid Valley and to Batu Caves', async () => {
    const t0 = performance.now();
    const a = await transitRoute(KLCC, MID_VALLEY, true) as any;
    const b = await transitRoute(KLCC, BATU_CAVES, true) as any;
    console.log('KLCC→Mid Valley', summary(a), `(${Math.round(performance.now() - t0)} ms incl. load)`);
    console.log('KLCC→Batu Caves', summary(b));
    expect(a.available).toBe(true);
    expect(a.steps.every((s: any) => s.mode === 'train')).toBe(true);
    expect(a.duration).toBeGreaterThan(10 * 60);
    expect(a.duration).toBeLessThan(60 * 60);
    expect(b.available).toBe(true);
    expect(b.attribution).toContain('data.gov.my');
  });

  it('Singapore by MRT: Changi Airport to Orchard', async () => {
    const t0 = performance.now();
    const r = await transitRoute(CHANGI, ORCHARD, true) as any;
    console.log('Changi→Orchard', summary(r), `(${Math.round(performance.now() - t0)} ms)`);
    expect(r.available).toBe(true);
    expect(r.duration).toBeLessThan(80 * 60);
    expect(r.attribution).toContain('OpenStreetMap');
  });

  it('bus-only cities: Ipoh and Penang', async () => {
    expect((await transitRoute(IPOH_STATION, IPOH_PARADE, true)).available).toBe(false); // no rail there
    const t0 = performance.now();
    const ipoh = await transitRoute(IPOH_STATION, IPOH_PARADE, false) as any;
    const penang = await transitRoute(KOMTAR, BATU_FERRINGHI, false) as any;
    console.log('Ipoh', summary(ipoh), `(${Math.round(performance.now() - t0)} ms)`);
    console.log('Penang', summary(penang));
    expect(ipoh.available).toBe(true);
    expect(penang.available).toBe(true);
    expect(penang.steps.some((s: any) => s.mode === 'bus')).toBe(true);
  });

  it('Kuala Lumpur with buses and rail together stays fast', async () => {
    const t0 = performance.now();
    const r = await transitRoute([3.1390, 101.6869], [3.0738, 101.5183], false) as any; // KL Sentral → Sunway Pyramid
    const ms = Math.round(performance.now() - t0);
    console.log('KL Sentral→Sunway', summary(r), `(${ms} ms)`);
    expect(r.available).toBe(true);
    expect(ms).toBeLessThan(1500);
  });
});
