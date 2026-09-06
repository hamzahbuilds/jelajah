import { describe, it, expect } from 'vitest';
import { isOfflineResponse } from '../src/lib/pwa';

describe('isOfflineResponse', () => {
  it('true when X-Jelajah-Offline is "1"', () => {
    const headers = new Headers({ 'X-Jelajah-Offline': '1' });
    expect(isOfflineResponse(headers)).toBe(true);
  });

  it('false when the header is absent', () => {
    const headers = new Headers();
    expect(isOfflineResponse(headers)).toBe(false);
  });

  it('false when the header has some other value', () => {
    const headers = new Headers({ 'X-Jelajah-Offline': '0' });
    expect(isOfflineResponse(headers)).toBe(false);
  });

  it('works against a plain {get} shape, not just a real Headers instance', () => {
    const fake = { get: (n: string) => (n === 'X-Jelajah-Offline' ? '1' : null) };
    expect(isOfflineResponse(fake)).toBe(true);
  });
});
