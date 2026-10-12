import { describe, it, expect } from 'vitest';
import { tokyoRailRoute } from '../server/lib/tokyo-rail';
describe('Tokyo rail network', () => {
  it('draws observed rail shapes and transfers for teamLab to Sensoji', () => {
    const r = tokyoRailRoute([35.6491,139.7898],[35.7148,139.7967]);
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.estimated).toBe(true);
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.steps.length).toBeGreaterThan(1);
    expect(r.steps[0].fromStation).toContain('Shin-toyosu');
    expect(r.steps.at(-1)?.toStation).toContain('Asakusa');
    expect(r.steps.every(s => s.line && s.fromStation && s.toStation && s.duration > 0)).toBe(true);
    expect(r.stations[0]).toContain('Shin-toyosu');
    expect(r.stations.at(-1)).toContain('Asakusa');
    expect(r.segments.every(s=>s.mode==='train'&&s.points.length>2)).toBe(true);
    expect(r.connections[0].from).toEqual([35.6491,139.7898]);
    expect(r.connections.at(-1)?.to).toEqual([35.7148,139.7967]);
    expect(r.duration).toBeGreaterThan(600);
    expect(r.duration).toBeLessThan(7200);
    expect(r.segments.flatMap(s=>s.points).every(([lat,lng])=>lat>35&&lat<36&&lng>139&&lng<140)).toBe(true);
  });
  it('does not invent routes outside coverage', () => {
    expect(tokyoRailRoute([3.14,101.69],[3.16,101.71]).available).toBe(false);
    expect(tokyoRailRoute([35.6491,139.7898],[34.69,135.5]).available).toBe(false);
  });
  it('supports reverse trips from directed service edges', () => {
    const r=tokyoRailRoute([35.7148,139.7967],[35.6491,139.7898]);
    expect(r.available).toBe(true);
    if(r.available) expect(r.connections.at(-1)?.to).toEqual([35.6491,139.7898]);
  });
});
