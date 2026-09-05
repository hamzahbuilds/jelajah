// Pure, framework-free helpers for the lieflat-style admin charts.
// Style is adopted from lieflat-charts (PolyForm Noncommercial) — this module
// is hand-written from scratch, no code copied. Kept pure/testable per TDD.

/** Running total of a series, e.g. daily signups -> cumulative accounts. */
export function cumulative(series: number[]): number[] {
  let sum = 0;
  return series.map(n => (sum += n));
}

/**
 * Map a value series onto an SVG polyline's points, padded so the drawn path
 * never touches (let alone overflows) the viewBox edges. First point sits at
 * x=pad, last point at x=(w-pad); the max value sits at y=pad (near the top),
 * the min value at y=(h-pad) (near the bottom) — SVG y grows downward.
 */
export function linePoints(values: number[], w: number, h: number, pad: number): [number, number][] {
  if (values.length === 0) return [];
  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // flat series -> avoid divide-by-zero, draw a flat line
  return values.map((v, i) => {
    const x = values.length === 1 ? pad : pad + (i / (values.length - 1)) * innerW;
    const y = pad + (1 - (v - min) / span) * innerH;
    return [x, y];
  });
}
