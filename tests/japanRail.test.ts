import { describe, expect, it } from 'vitest';
import { transitCoverage, transitRoute } from '../server/lib/transit';

type P = [number, number];
const TOKYO: P = [35.6812, 139.7671], KYOTO: P = [34.9858, 135.7588];
const NAMBA: P = [34.6666, 135.5003], GION: P = [35.0037, 135.7788];
const HAKATA: P = [33.5902, 130.4207], TENJIN: P = [33.5911, 130.3990];
const SAPPORO: P = [43.0687, 141.3508], ODORI: P = [43.0606, 141.3546];

describe('Japan rail (v0.45)', () => {
  it('joins regional networks and the Shinkansen for a long trip, and stays local for a short one', () => {
    const ids = transitCoverage(TOKYO, KYOTO, true).map(m => m.id);
    expect(ids).toEqual(expect.arrayContaining(['jp-kanto-rail', 'jp-kansai-rail', 'jp-shinkansen']));
    expect(transitCoverage(NAMBA, GION, true).map(m => m.id)).not.toContain('jp-kanto-rail');
    expect(transitCoverage([3.15, 101.71], [3.14, 101.69], true).some(m => m.id.startsWith('jp-'))).toBe(false);
  });

  it('routes Tokyo to Kyoto on the Shinkansen in a sensible time', async () => {
    const r: any = await transitRoute(TOKYO, KYOTO, true);
    expect(r.available).toBe(true);
    expect(r.steps.some((s: any) => /Shinkansen/i.test(s.line))).toBe(true);
    expect(r.duration).toBeGreaterThan(100 * 60);
    expect(r.duration).toBeLessThan(260 * 60);
  });

  it.each([
    ['Osaka Namba → Gion', NAMBA, GION],
    ['Hakata → Tenjin', HAKATA, TENJIN],
    ['Sapporo → Odori', SAPPORO, ODORI],
  ])('finds a train route %s with English station names', async (_n, a, b) => {
    const r: any = await transitRoute(a as P, b as P, true);
    expect(r.available).toBe(true);
    expect(r.duration).toBeLessThan(90 * 60);
    expect(r.steps.every((s: any) => /[A-Za-z]/.test(s.fromStation + s.toStation))).toBe(true);
    expect(r.segments.length).toBeGreaterThan(0);
  });

  it('draws hops along the real track where OSM has it', async () => {
    const r: any = await transitRoute(TOKYO, KYOTO, true);
    expect(r.segments.some((s: any) => s.points.length > 2)).toBe(true);
  });
});
