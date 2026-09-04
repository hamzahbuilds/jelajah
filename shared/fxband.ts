// Band + signal math for the trip forex widget (spec: docs/05-spec-v0.15-forex.md).
//
// DIRECTION: the app displays "1 {ref} = X {quote}" (e.g. 1 MYR = 38.5 JPY),
// but "cheap/expensive" must describe the FOREIGN currency, so the signal is
// computed on cost = 1/rate (what one JPY costs in MYR). A HIGH display rate
// therefore means the foreign currency is CHEAP → good time to buy.
// tests/fxband.test.ts pins this against hand-computed fixtures.

export type FxWindow = '1w' | '1m' | '3m' | '6m' | '1y';
export const FX_WINDOWS: Record<FxWindow, number> = { '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365 };

export type FxSignal = 'buy' | 'ok' | 'wait';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** avgLow = mean of below-mean days, avgHigh = mean of above-mean days. */
export function costBand(costs: number[]): { mean: number; avgLow: number; avgHigh: number } | null {
  if (costs.length < 5) return null;
  const m = mean(costs);
  const lows = costs.filter(c => c < m);
  const highs = costs.filter(c => c > m);
  // a flat series has no below/above set — collapse the band onto the mean
  return { mean: m, avgLow: lows.length ? mean(lows) : m, avgHigh: highs.length ? mean(highs) : m };
}

/** Input: chronological DISPLAY-rate series; last element is current. */
export function analyzeRates(rates: number[]): { band: { low: number; high: number } | null; signal: FxSignal | null } {
  const costs = rates.map(r => 1 / r);
  const cb = costBand(costs);
  if (!cb) return { band: null, signal: null };
  const c = costs[costs.length - 1];
  const signal: FxSignal = c < cb.avgLow ? 'buy' : c > cb.avgHigh ? 'wait' : 'ok';
  // display band: dividing 1 by the cost band SWAPS low and high
  return { band: { low: 1 / cb.avgHigh, high: 1 / cb.avgLow }, signal };
}
