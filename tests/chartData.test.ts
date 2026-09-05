import { describe, expect, it } from 'vitest';
import { cumulative, linePoints } from '../src/components/charts/chartData';

describe('cumulative', () => {
  it('returns a running total', () => {
    expect(cumulative([1, 0, 2, 3])).toEqual([1, 1, 3, 6]);
  });

  it('handles an empty series', () => {
    expect(cumulative([])).toEqual([]);
  });

  it('handles all-zero series', () => {
    expect(cumulative([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3];
    cumulative(input);
    expect(input).toEqual([1, 2, 3]);
  });
});

describe('linePoints', () => {
  it('maps a flat-zero series onto the baseline, inside the viewBox', () => {
    const pts = linePoints([0, 0, 0], 300, 90, 4);
    expect(pts).toHaveLength(3);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(300);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(90);
    }
  });

  it('places the first point at the left pad and the last point at the right pad', () => {
    const pts = linePoints([0, 5, 10], 300, 90, 4);
    expect(pts[0][0]).toBeCloseTo(4);
    expect(pts[2][0]).toBeCloseTo(296);
  });

  it('places the max value at the top pad and the min at the bottom pad', () => {
    const pts = linePoints([0, 10], 300, 90, 4);
    expect(pts[1][1]).toBeCloseTo(4); // max value -> near top
    expect(pts[0][1]).toBeCloseTo(86); // min value -> near bottom
  });

  it('never overflows the viewBox even with a single point', () => {
    const pts = linePoints([5], 300, 90, 4);
    expect(pts).toHaveLength(1);
    expect(pts[0][0]).toBeGreaterThanOrEqual(0);
    expect(pts[0][0]).toBeLessThanOrEqual(300);
  });

  it('handles an empty series', () => {
    expect(linePoints([], 300, 90, 4)).toEqual([]);
  });
});
