import { describe, expect, it } from 'vitest';
import { lineColors, mergeTransit } from '../src/components/transitLines';

const hop = (line: string, a: string, b: string, p: [number, number], q: [number, number], color?: string) =>
  ({ points: [p, q] as [number, number][], mode: 'train', label: `${line}: ${a} → ${b}`, color });

describe('mergeTransit', () => {
  it('joins station hops on one line into a single ride', () => {
    const { routes, transfers } = mergeTransit([
      hop('Kelana Jaya Line', 'KLCC', 'Ampang Park', [3.15, 101.71], [3.16, 101.72]),
      hop('Kelana Jaya Line', 'Ampang Park', 'Damai', [3.16, 101.72], [3.17, 101.73]),
      hop('Kelana Jaya Line', 'Damai', 'Dato Keramat', [3.17, 101.73], [3.18, 101.74]),
    ]);
    expect(routes).toHaveLength(1);
    expect(routes[0].points).toHaveLength(4);
    expect(routes[0].label).toBe('Kelana Jaya Line: KLCC → Dato Keramat');
    expect((routes[0] as any).stops).toBe(3);
    expect(transfers).toEqual([]);
  });

  it('gives a new line a different colour and marks the change', () => {
    const { routes, transfers } = mergeTransit([
      hop('A', 's1', 's2', [0, 0], [0, 0.01]),
      hop('A', 's2', 's3', [0, 0.01], [0, 0.02]),
      hop('B', 's3', 's4', [0, 0.02], [0, 0.03]),
    ]);
    expect(routes).toHaveLength(2);
    expect(routes[0].color).not.toBe(routes[1].color);
    expect(transfers).toEqual([{ at: [0, 0.02], from: 'A', to: 'B', color: routes[1].color, walk: false }]);
  });

  it('keeps feed colours, but never repeats one across a change of line', () => {
    const { routes, transfers } = mergeTransit([
      hop('A', 's1', 's2', [0, 0], [0, 0.01], '#E0001B'),
      hop('B', 'x1', 'x2', [0, 0.03], [0, 0.04], '#e0001b'),
    ]);
    expect(routes[0].color).toBe('#E0001B');
    expect(routes[1].color?.toLowerCase()).not.toBe('#e0001b');
    expect(transfers[0].walk).toBe(true);
  });

  it('leaves walking and driving routes alone', () => {
    const walk = { points: [[0, 0], [0, 1]] as [number, number][], mode: 'walk', label: 'Station' };
    const { routes } = mergeTransit([walk, hop('A', 'a', 'b', [0, 1], [0, 2]), walk]);
    expect(routes).toHaveLength(3);
    expect(routes[0]).toBe(walk);
  });

  it('maps each ride of a line to its colour and stop count for the directions', () => {
    const c = lineColors([hop('A', 'a', 'b', [0, 0], [0, 0.01], '#123456'), hop('A', 'b', 'c', [0, 0.01], [0, 0.02], '#123456')]);
    expect(c.get('A')).toEqual([{ color: '#123456', stops: 2 }]);
  });
});
