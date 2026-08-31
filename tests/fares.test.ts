import { describe, it, expect } from 'vitest';
import { haversine, metroFareJpy, taxiFareJpy, estimates } from '../shared/fares';

describe('fares module', () => {
  it('haversine: Tokyo Station → Shibuya ≈ 6.5 km', () => {
    const d = haversine(35.6812, 139.7671, 35.6580, 139.7016);
    expect(d).toBeGreaterThan(5500);
    expect(d).toBeLessThan(7500);
  });

  it('recommends walking under 1 km, free', () => {
    const est = estimates(600);
    const rec = est.find(e => e.recommended)!;
    expect(rec.mode).toBe('walk');
    expect(rec.fareJpy).toBe(0);
    expect(rec.minutes).toBeGreaterThan(0);
  });

  it('recommends train for 8 km with banded fare', () => {
    const est = estimates(8000);
    const rec = est.find(e => e.recommended)!;
    expect(rec.mode).toBe('train');
    expect(rec.fareJpy).toBe(260); // 8 km band
  });

  it('recommends intercity above 40 km (~¥25/km)', () => {
    const est = estimates(60000);
    const rec = est.find(e => e.recommended)!;
    expect(rec.mode).toBe('intercity');
    expect(rec.fareJpy).toBe(1500);
  });

  it('taxi meter: flagfall then ¥100/255m', () => {
    expect(taxiFareJpy(1.0)).toBe(500);
    expect(taxiFareJpy(2.0)).toBe(500 + Math.ceil(904 / 255) * 100); // 0.904km over
  });

  it('metro bands are monotonic', () => {
    let prev = 0;
    for (const km of [1, 5, 9, 13, 17, 22, 35]) {
      const f = metroFareJpy(km);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('zero distance stays sane', () => {
    const est = estimates(0);
    expect(est.find(e => e.recommended)!.mode).toBe('walk');
    expect(est.every(e => e.minutes >= 0 && e.fareJpy >= 0)).toBe(true);
  });
});
