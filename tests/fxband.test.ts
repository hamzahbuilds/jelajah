import { describe, it, expect } from 'vitest';
import { costBand, analyzeRates, FX_WINDOWS } from '../shared/fxband';

describe('fxband', () => {
  it('splits a window into average low and average high around the mean', () => {
    // mean 14; below-mean {10,12} → avgLow 11; above-mean {16,18} → avgHigh 17
    expect(costBand([10, 12, 14, 16, 18])).toEqual({ mean: 14, avgLow: 11, avgHigh: 17 });
  });

  it('needs at least 5 points', () => {
    expect(costBand([10, 12, 14, 16])).toBeNull();
    expect(analyzeRates([40, 41, 42, 43])).toEqual({ band: null, signal: null });
  });

  it('a flat series is "ok", never a fake signal', () => {
    const r = analyzeRates([40, 40, 40, 40, 40]);
    expect(r.signal).toBe('ok');
    expect(r.band).toEqual({ low: 40, high: 40 });
  });

  // THE INVERSION PIN — display rate is "1 MYR = X JPY"; the signal is about
  // the COST of JPY. A HIGH display rate means JPY is CHEAP (buy); a LOW
  // display rate means JPY is EXPENSIVE (wait). If someone "simplifies" the
  // 1/rate step away, these two tests fail.
  it('series ending at its cheapest foreign-currency point says buy', () => {
    // display rates; last = 55 = the most yen per ringgit seen → buy
    expect(analyzeRates([50, 48, 52, 45, 55]).signal).toBe('buy');
  });

  it('series ending at its most expensive foreign-currency point says wait', () => {
    // last = 45 = the least yen per ringgit seen → wait
    expect(analyzeRates([50, 48, 52, 55, 45]).signal).toBe('wait');
  });

  it('band is returned in display terms with low < high', () => {
    // costs: 1/50=.02, 1/48=.0208333, 1/52=.0192308, 1/55=.0181818, 1/45=.0222222
    // cost mean .0200936; below-mean {.02,.0192308,.0181818} → avgLow .0191375
    // above-mean {.0208333,.0222222} → avgHigh .0215278
    // display band: low = 1/avgHigh = 46.45, high = 1/avgLow = 52.25
    const { band } = analyzeRates([50, 48, 52, 55, 45]);
    expect(band!.low).toBeCloseTo(46.45, 1);
    expect(band!.high).toBeCloseTo(52.25, 1);
  });

  it('a mid-band current rate is ok', () => {
    expect(analyzeRates([50, 48, 52, 55, 45, 49]).signal).toBe('ok');
  });

  it('window map is the approved five windows', () => {
    expect(FX_WINDOWS).toEqual({ '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365 });
  });
});
