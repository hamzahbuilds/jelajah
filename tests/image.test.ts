import { describe, it, expect } from 'vitest';
import { fitWithin } from '../src/lib/image';

// resizeImageFile (canvas/createImageBitmap based) is browser-only and not
// unit-tested here — it has no DOM/canvas in the vitest node environment.
// fitWithin is the pure math it relies on, and is fully covered below.
describe('fitWithin', () => {
  it('scales a landscape image down to the max on its longest side', () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ w: 1280, h: 960 });
  });

  it('scales a portrait image down to the max on its longest side', () => {
    expect(fitWithin(3000, 4000, 1280)).toEqual({ w: 960, h: 1280 });
  });

  it('never upscales an image already smaller than the max', () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ w: 800, h: 600 });
  });

  it('rounds to integers', () => {
    expect(fitWithin(1000, 333, 700)).toEqual({ w: 700, h: 233 });
  });

  it('leaves an exact-max square untouched', () => {
    expect(fitWithin(1280, 1280, 1280)).toEqual({ w: 1280, h: 1280 });
  });
});
